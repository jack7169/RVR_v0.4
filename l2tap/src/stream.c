#include "../include/l2tap.h"
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <fcntl.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <arpa/inet.h>

static int set_nonblock(int fd)
{
    int flags = fcntl(fd, F_GETFL, 0);
    if (flags < 0)
        return -1;
    return fcntl(fd, F_SETFL, flags | O_NONBLOCK);
}

static int set_tcp_nodelay(int fd)
{
    int val = 1;
    return setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &val, sizeof(val));
}

static void stream_init(struct stream *s, int slot)
{
    memset(s, 0, sizeof(*s));
    s->fd = -1;
    s->state = STREAM_FREE;
    s->slot = slot;
}

int stream_find_free(struct l2tap_ctx *ctx)
{
    /* Slot 0 is reserved for broadcast/multicast */
    for (int i = 1; i < MAX_STREAMS; i++) {
        if (ctx->streams[i].state == STREAM_FREE)
            return i;
    }
    return -1;
}

int stream_listen(struct l2tap_ctx *ctx)
{
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) {
        LOG_ERR("socket: %m");
        return -1;
    }

    int val = 1;
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &val, sizeof(val));
    set_nonblock(fd);

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons(ctx->cfg.listen_port);
    inet_pton(AF_INET, ctx->cfg.listen_addr, &addr.sin_addr);

    if (bind(fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
        LOG_ERR("bind %s:%d: %m", ctx->cfg.listen_addr, ctx->cfg.listen_port);
        close(fd);
        return -1;
    }

    if (listen(fd, LISTEN_BACKLOG) < 0) {
        LOG_ERR("listen: %m");
        close(fd);
        return -1;
    }

    /* Add listen fd to epoll */
    struct epoll_event ev = {
        .events = EPOLLIN,
        .data.fd = fd,
    };
    if (epoll_ctl(ctx->epoll_fd, EPOLL_CTL_ADD, fd, &ev) < 0) {
        LOG_ERR("epoll_ctl add listen: %m");
        close(fd);
        return -1;
    }

    ctx->listen_fd = fd;
    LOG_INFO("listening on %s:%d", ctx->cfg.listen_addr, ctx->cfg.listen_port);
    return 0;
}

int stream_accept(struct l2tap_ctx *ctx)
{
    struct sockaddr_in peer;
    socklen_t plen = sizeof(peer);

    int fd = accept(ctx->listen_fd, (struct sockaddr *)&peer, &plen);
    if (fd < 0) {
        if (errno == EAGAIN || errno == EWOULDBLOCK)
            return 0;
        LOG_ERR("accept: %m");
        return -1;
    }

    set_nonblock(fd);
    set_tcp_nodelay(fd);

    /* Find a free slot — for server mode, accepted connections don't have
       a flow assignment yet. They'll be used when a flow needs a stream
       and this slot is the next free one. But actually in server mode,
       the remote side initiates connections per-flow, so we just accept
       and read from them. */
    int idx = -1;

    /* First check if stream 0 (broadcast) needs to be filled */
    if (ctx->streams[0].state == STREAM_FREE)
        idx = 0;
    else
        idx = stream_find_free(ctx);

    if (idx < 0) {
        LOG_WARN("no free stream slots, rejecting connection");
        close(fd);
        return 0;
    }

    struct stream *s = &ctx->streams[idx];
    stream_init(s, idx);
    s->fd = fd;
    s->state = STREAM_ACTIVE;
    s->last_active = time(NULL);
    ctx->stream_count++;

    struct epoll_event ev = {
        .events = EPOLLIN | EPOLLHUP | EPOLLERR,
        .data.fd = fd,
    };
    epoll_ctl(ctx->epoll_fd, EPOLL_CTL_ADD, fd, &ev);

    char ip[INET_ADDRSTRLEN];
    inet_ntop(AF_INET, &peer.sin_addr, ip, sizeof(ip));
    LOG_INFO("accepted stream[%d] from %s:%d (fd=%d)",
             idx, ip, ntohs(peer.sin_port), fd);
    return idx;
}

int stream_connect(struct l2tap_ctx *ctx)
{
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) {
        LOG_ERR("socket: %m");
        return -1;
    }

    set_nonblock(fd);
    set_tcp_nodelay(fd);

    struct sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons(ctx->cfg.connect_port);
    inet_pton(AF_INET, ctx->cfg.connect_addr, &addr.sin_addr);

    /* Find a free slot */
    int idx = -1;
    if (ctx->streams[0].state == STREAM_FREE)
        idx = 0;  /* broadcast stream gets priority */
    else
        idx = stream_find_free(ctx);

    if (idx < 0) {
        LOG_WARN("no free stream slots");
        close(fd);
        return -1;
    }

    struct stream *s = &ctx->streams[idx];
    stream_init(s, idx);
    s->fd = fd;
    s->last_active = time(NULL);

    int ret = connect(fd, (struct sockaddr *)&addr, sizeof(addr));
    if (ret < 0 && errno != EINPROGRESS) {
        LOG_ERR("connect %s:%d: %m", ctx->cfg.connect_addr, ctx->cfg.connect_port);
        close(fd);
        s->state = STREAM_FREE;
        s->fd = -1;
        return -1;
    }

    if (ret == 0) {
        /* Immediate connect (localhost) */
        s->state = STREAM_ACTIVE;
        struct epoll_event ev = {
            .events = EPOLLIN | EPOLLHUP | EPOLLERR,
            .data.fd = fd,
        };
        epoll_ctl(ctx->epoll_fd, EPOLL_CTL_ADD, fd, &ev);
    } else {
        /* Connect in progress */
        s->state = STREAM_CONNECTING;
        struct epoll_event ev = {
            .events = EPOLLOUT | EPOLLHUP | EPOLLERR,
            .data.fd = fd,
        };
        epoll_ctl(ctx->epoll_fd, EPOLL_CTL_ADD, fd, &ev);
    }

    ctx->stream_count++;

    LOG_DBG("connecting stream[%d] to %s:%d (fd=%d)",
            idx, ctx->cfg.connect_addr, ctx->cfg.connect_port, fd);
    return idx;
}

void stream_close(struct l2tap_ctx *ctx, int idx)
{
    if (idx < 0 || idx >= MAX_STREAMS)
        return;

    struct stream *s = &ctx->streams[idx];
    if (s->state == STREAM_FREE)
        return;

    LOG_DBG("closing stream[%d] fd=%d", idx, s->fd);

    if (s->fd >= 0) {
        epoll_ctl(ctx->epoll_fd, EPOLL_CTL_DEL, s->fd, NULL);
        close(s->fd);
    }

    /* Remove flow entries pointing to this stream */
    flow_remove_stream(ctx, idx);

    stream_init(s, idx);
    ctx->stream_count--;
}

int stream_flush(struct l2tap_ctx *ctx, int idx)
{
    struct stream *s = &ctx->streams[idx];
    if (s->wlen == 0)
        return 0;

    ssize_t n = write(s->fd, s->wbuf, s->wlen);
    if (n < 0) {
        if (errno == EAGAIN || errno == EWOULDBLOCK)
            return 0;
        LOG_ERR("stream[%d] write error: %m", idx);
        return -1;
    }

    if ((size_t)n < s->wlen) {
        memmove(s->wbuf, s->wbuf + n, s->wlen - n);
        s->wlen -= n;
    } else {
        s->wlen = 0;
        /* No more pending writes — switch back to EPOLLIN only */
        struct epoll_event ev = {
            .events = EPOLLIN | EPOLLHUP | EPOLLERR,
            .data.fd = s->fd,
        };
        epoll_ctl(ctx->epoll_fd, EPOLL_CTL_MOD, s->fd, &ev);
    }

    return 0;
}
