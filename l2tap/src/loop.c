#define _POSIX_C_SOURCE 199309L
#include "../include/l2tap.h"
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <sys/socket.h>
#include <time.h>

#define MAX_EVENTS  64
#define EPOLL_TIMEOUT_MS  100

/* Find stream by fd */
static struct stream *find_stream_by_fd(struct l2tap_ctx *ctx, int fd)
{
    for (int i = 0; i < MAX_STREAMS; i++) {
        if (ctx->streams[i].fd == fd && ctx->streams[i].state != STREAM_FREE)
            return &ctx->streams[i];
    }
    return NULL;
}

/* Handle TAP readable: read Ethernet frame, classify, send to stream */
static void handle_tap_read(struct l2tap_ctx *ctx)
{
    uint8_t frame[MAX_FRAME_LEN];

    ssize_t n = read(ctx->tap_fd, frame, sizeof(frame));
    if (n <= 0) {
        if (n < 0 && errno != EAGAIN)
            LOG_ERR("tap read: %m");
        return;
    }

    if (n < 14) {
        LOG_DBG("tap: runt frame (%zd bytes)", n);
        return;
    }

    ctx->tap_rx_frames++;
    ctx->tap_rx_bytes += n;

    /* Ethernet header: dst[6] src[6] type[2] */
    uint8_t *dst_mac = frame;
    uint8_t *src_mac = frame + MAC_LEN;

    int stream_idx;

    /* Broadcast/multicast -> stream 0 */
    if (MAC_IS_MULTICAST(dst_mac)) {
        stream_idx = 0;
    } else {
        /* Lookup existing flow */
        stream_idx = flow_lookup(ctx, src_mac, dst_mac);

        if (stream_idx < 0) {
            /* New flow — need a new stream */
            if (ctx->cfg.mode == MODE_CLIENT) {
                /* Client: open a new TCP connection to kcptun */
                stream_idx = stream_connect(ctx);
                if (stream_idx < 0) {
                    LOG_WARN("dropping frame: cannot create stream");
                    return;
                }
            } else {
                /* Server: we accept connections, can't initiate.
                   Find an active stream without a flow assignment. */
                stream_idx = -1;
                for (int i = 1; i < MAX_STREAMS; i++) {
                    if (ctx->streams[i].state == STREAM_ACTIVE) {
                        int has_flow = 0;
                        for (int b = 0; b < FLOW_BUCKETS && !has_flow; b++) {
                            struct flow_entry *e = ctx->flow_table[b];
                            while (e) {
                                if (e->stream_idx == i) {
                                    has_flow = 1;
                                    break;
                                }
                                e = e->next;
                            }
                        }
                        if (!has_flow) {
                            stream_idx = i;
                            break;
                        }
                    }
                }

                if (stream_idx < 0) {
                    /* No free stream — use broadcast stream as fallback.
                     * This ensures unicast replies (ARP, ICMP) aren't dropped
                     * when the client hasn't opened a dedicated stream yet. */
                    if (ctx->streams[0].state == STREAM_ACTIVE) {
                        stream_idx = 0;
                        LOG_DBG("no free stream for unicast, using broadcast stream 0");
                    } else {
                        LOG_DBG("no available stream, dropping frame");
                        return;
                    }
                }
            }

            /* Record the flow -> stream mapping */
            flow_assign_to(ctx, src_mac, dst_mac, stream_idx);
        }
    }

    /* Verify stream is usable */
    if (stream_idx < 0 || stream_idx >= MAX_STREAMS)
        return;

    struct stream *s = &ctx->streams[stream_idx];
    if (s->state != STREAM_ACTIVE) {
        if (s->state == STREAM_CONNECTING) {
            /* Buffer the frame — it'll be sent when connect completes.
               For simplicity, drop frames to connecting streams. */
            LOG_DBG("stream[%d] still connecting, dropping frame", stream_idx);
        }
        return;
    }

    s->last_active = time(NULL);

    /* Check age of oldest data in write buffer — enforce latency thresholds */
    if (s->wlen > 0 && ctx->cfg.hard_latency_ms > 0) {
        struct timespec now_ts;
        clock_gettime(CLOCK_MONOTONIC, &now_ts);
        long age_ms = (now_ts.tv_sec - s->wbuf_oldest.tv_sec) * 1000 +
                      (now_ts.tv_nsec - s->wbuf_oldest.tv_nsec) / 1000000;
        if (age_ms > ctx->cfg.hard_latency_ms) {
            /* Hard cut — drop the stale buffered data and this frame */
            LOG_DBG("stream[%d] hard drop: buffer age %ldms > %dms, clearing %zu bytes",
                    stream_idx, age_ms, ctx->cfg.hard_latency_ms, s->wlen);
            s->wlen = 0;
            ctx->hard_drops++;
            return;
        } else if (age_ms > ctx->cfg.soft_latency_ms) {
            ctx->soft_drops++;
        }
    }

    /* Timestamp when write buffer first gets data */
    if (s->wlen == 0) {
        clock_gettime(CLOCK_MONOTONIC, &s->wbuf_oldest);
    }

    int ret = frame_write(s, frame, (uint16_t)n, 0);
    if (ret < 0) {
        LOG_WARN("stream[%d] frame_write failed, closing", stream_idx);
        stream_close(ctx, stream_idx);
    } else if (ret == 1) {
        /* Data buffered — enable EPOLLOUT */
        struct epoll_event ev = {
            .events = EPOLLIN | EPOLLOUT | EPOLLHUP | EPOLLERR,
            .data.fd = s->fd,
        };
        epoll_ctl(ctx->epoll_fd, EPOLL_CTL_MOD, s->fd, &ev);
    }
}

/* Handle stream readable: read TCP data, extract frames, write to TAP */
static void handle_stream_read(struct l2tap_ctx *ctx, struct stream *s)
{
    /* Read into stream's read buffer */
    size_t space = READ_BUF_SIZE - s->rlen;
    if (space == 0) {
        LOG_WARN("stream[%d] read buffer full", s->slot);
        return;
    }

    ssize_t n = read(s->fd, s->rbuf + s->rlen, space);
    if (n <= 0) {
        if (n == 0) {
            LOG_INFO("stream[%d] closed by peer", s->slot);
        } else if (errno != EAGAIN) {
            LOG_ERR("stream[%d] read: %m", s->slot);
        } else {
            return;  /* EAGAIN, nothing to do */
        }
        stream_close(ctx, s->slot);
        return;
    }

    s->rlen += n;
    s->last_active = time(NULL);

    /* Extract complete frames and write to TAP */
    uint8_t frame[MAX_FRAME_LEN];
    uint16_t flen, fseq;

    while (1) {
        int ret = frame_read(s, frame, &flen, &fseq);
        if (ret == 0)
            break;  /* incomplete */
        if (ret < 0) {
            LOG_ERR("stream[%d] protocol error, closing", s->slot);
            stream_close(ctx, s->slot);
            return;
        }

        /* Sequence gap detection */
        if (s->rx_seq_init) {
            uint16_t expected = s->rx_seq;
            if (fseq != expected) {
                /* Gap detected — frames were lost in transit */
                uint16_t gap = (fseq >= expected) ? (fseq - expected) : (65536 - expected + fseq);
                if (gap < 32768) { /* forward gap, not wrap-around confusion */
                    ctx->seq_drops += gap;
                    LOG_INFO("stream[%d] seq gap: expected %u got %u (%u frames lost)",
                             s->slot, expected, fseq, gap);
                }
            }
        } else {
            s->rx_seq_init = 1;
        }
        s->rx_seq = fseq + 1;

        /* Write raw Ethernet frame to TAP */
        ssize_t w = write(ctx->tap_fd, frame, flen);
        if (w < 0 && errno != EAGAIN) {
            LOG_ERR("tap write: %m");
        } else if (w > 0) {
            ctx->tap_tx_frames++;
            ctx->tap_tx_bytes += flen;
        }
    }
}

/* Handle connect completion */
static void handle_connect_complete(struct l2tap_ctx *ctx, struct stream *s)
{
    int err = 0;
    socklen_t len = sizeof(err);
    getsockopt(s->fd, SOL_SOCKET, SO_ERROR, &err, &len);

    if (err != 0) {
        LOG_ERR("stream[%d] connect failed: %s", s->slot, strerror(err));
        stream_close(ctx, s->slot);
        return;
    }

    s->state = STREAM_ACTIVE;
    LOG_INFO("stream[%d] connected (fd=%d)", s->slot, s->fd);

    /* Switch to read mode */
    struct epoll_event ev = {
        .events = EPOLLIN | EPOLLHUP | EPOLLERR,
        .data.fd = s->fd,
    };
    epoll_ctl(ctx->epoll_fd, EPOLL_CTL_MOD, s->fd, &ev);

    /* Flush any buffered writes */
    if (s->wlen > 0) {
        ev.events = EPOLLIN | EPOLLOUT | EPOLLHUP | EPOLLERR;
        epoll_ctl(ctx->epoll_fd, EPOLL_CTL_MOD, s->fd, &ev);
    }
}

int event_loop(struct l2tap_ctx *ctx)
{
    struct epoll_event events[MAX_EVENTS];
    time_t now;

    LOG_INFO("entering event loop (mode=%s)",
             ctx->cfg.mode == MODE_SERVER ? "server" : "client");

    /* In client mode, open the broadcast stream (stream 0) immediately */
    if (ctx->cfg.mode == MODE_CLIENT) {
        int idx = stream_connect(ctx);
        if (idx < 0)
            LOG_WARN("failed to open broadcast stream, will retry");
        else
            LOG_INFO("broadcast stream[0] connecting");
    }

    while (ctx->running) {
        int nfds = epoll_wait(ctx->epoll_fd, events, MAX_EVENTS,
                              EPOLL_TIMEOUT_MS);

        if (nfds < 0) {
            if (errno == EINTR)
                continue;
            LOG_ERR("epoll_wait: %m");
            return -1;
        }

        for (int i = 0; i < nfds; i++) {
            int fd = events[i].data.fd;
            uint32_t ev = events[i].events;

            /* TAP device */
            if (fd == ctx->tap_fd) {
                if (ev & EPOLLIN)
                    handle_tap_read(ctx);
                continue;
            }

            /* Listen socket (server mode) */
            if (fd == ctx->listen_fd) {
                if (ev & EPOLLIN)
                    stream_accept(ctx);
                continue;
            }

            /* Stream socket */
            struct stream *s = find_stream_by_fd(ctx, fd);
            if (!s) {
                LOG_WARN("epoll event for unknown fd=%d", fd);
                epoll_ctl(ctx->epoll_fd, EPOLL_CTL_DEL, fd, NULL);
                close(fd);
                continue;
            }

            if (ev & (EPOLLHUP | EPOLLERR)) {
                LOG_INFO("stream[%d] hangup/error", s->slot);
                stream_close(ctx, s->slot);
                continue;
            }

            if (s->state == STREAM_CONNECTING && (ev & EPOLLOUT)) {
                handle_connect_complete(ctx, s);
                continue;
            }

            if (ev & EPOLLOUT) {
                if (stream_flush(ctx, s->slot) < 0) {
                    stream_close(ctx, s->slot);
                    continue;
                }
            }

            if (ev & EPOLLIN) {
                handle_stream_read(ctx, s);
            }
        }

        /* Periodic tasks */
        now = time(NULL);

        if (now - ctx->last_gc >= GC_INTERVAL) {
            flow_gc(ctx);
            ctx->last_gc = now;

            /* Client mode: ensure broadcast stream 0 is alive */
            if (ctx->cfg.mode == MODE_CLIENT &&
                ctx->streams[0].state == STREAM_FREE) {
                LOG_INFO("reconnecting broadcast stream[0]");
                stream_connect(ctx);
            }
        }

        if (now - ctx->last_stats >= STATS_INTERVAL) {
            stats_write_file(ctx);
            ctx->last_stats = now;
        }
    }

    LOG_INFO("event loop exiting");
    return 0;
}
