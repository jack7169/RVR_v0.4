#ifndef L2TAP_H
#define L2TAP_H

#include <stdint.h>
#include <stddef.h>
#include <sys/epoll.h>
#include <time.h>

/* ── Constants ─────────────────────────────────────────────────────────── */

#define MAX_STREAMS      128
#define IDLE_TIMEOUT     300   /* seconds before idle flow is reaped */
#define FRAME_HDR_LEN    4     /* [2B length BE][2B flags] */
#define MAX_FRAME_LEN    1518  /* standard Ethernet MTU + header */
#define LISTEN_BACKLOG   32
#define FLOW_BUCKETS     256
#define STATS_INTERVAL   10    /* seconds between stats file writes */
#define GC_INTERVAL      10    /* seconds between flow garbage collection */
#define CONNECT_RETRY_MS 1000  /* ms between reconnect attempts (client) */
#define READ_BUF_SIZE    (FRAME_HDR_LEN + MAX_FRAME_LEN + 64)
#define WRITE_BUF_SIZE   (FRAME_HDR_LEN + MAX_FRAME_LEN) * 256  /* ~390KB, absorbs bursts during TCP backpressure */

/* Frame flags */
#define FLAG_NONE        0x0000

/* Stream states */
#define STREAM_FREE       0
#define STREAM_CONNECTING  1
#define STREAM_ACTIVE      2

/* Operating modes */
#define MODE_SERVER  0
#define MODE_CLIENT  1

/* ── MAC helpers ───────────────────────────────────────────────────────── */

#define MAC_LEN  6
#define MAC_IS_MULTICAST(mac)  ((mac)[0] & 0x01)
#define MAC_IS_BROADCAST(mac)  ((mac)[0] == 0xff && (mac)[1] == 0xff && \
                                (mac)[2] == 0xff && (mac)[3] == 0xff && \
                                (mac)[4] == 0xff && (mac)[5] == 0xff)

/* ── Structures ────────────────────────────────────────────────────────── */

struct stream {
    int       fd;
    int       state;
    int       slot;            /* index in ctx->streams[] */

    /* Read buffer (TCP reassembly) */
    uint8_t   rbuf[READ_BUF_SIZE];
    size_t    rlen;

    /* Write buffer (backpressure) */
    uint8_t   wbuf[WRITE_BUF_SIZE];
    size_t    wlen;

    /* Stats */
    uint64_t  bytes_rx;
    uint64_t  bytes_tx;
    uint64_t  frames_rx;
    uint64_t  frames_tx;

    time_t    last_active;
};

struct flow_entry {
    uint8_t   src_mac[MAC_LEN];
    uint8_t   dst_mac[MAC_LEN];
    int       stream_idx;      /* index into ctx->streams[], or -1 */
    time_t    last_seen;
    struct flow_entry *next;   /* hash chain */
};

struct l2tap_config {
    int       mode;            /* MODE_SERVER or MODE_CLIENT */
    char      listen_addr[64]; /* server: address to listen on */
    int       listen_port;
    char      connect_addr[64];/* client: address to connect to */
    int       connect_port;
    char      tap_name[16];    /* TAP interface name */
    char      up_script[256];  /* script to run after TAP creation */
    char      down_script[256];/* script to run before shutdown */
    char      stats_file[256]; /* path to write periodic stats */
    int       verbose;
};

struct l2tap_ctx {
    struct l2tap_config  cfg;
    int                  tap_fd;
    int                  epoll_fd;
    int                  listen_fd;     /* server mode only */
    struct stream        streams[MAX_STREAMS];
    int                  stream_count;  /* number of active streams */
    struct flow_entry   *flow_table[FLOW_BUCKETS];
    int                  flow_count;
    volatile int         running;

    /* Stats */
    uint64_t             tap_rx_bytes;
    uint64_t             tap_tx_bytes;
    uint64_t             tap_rx_frames;
    uint64_t             tap_tx_frames;

    /* Timers */
    time_t               last_gc;
    time_t               last_stats;
};

/* ── tap.c ─────────────────────────────────────────────────────────────── */

int  tap_open(const char *name);
int  tap_set_mtu(const char *name, int mtu);
int  tap_set_up(const char *name);

/* ── frame.c ───────────────────────────────────────────────────────────── */

/*
 * Write a framed Ethernet packet to a stream.
 * Returns 0 on success, -1 on fatal error, 1 if buffered (EAGAIN).
 */
int  frame_write(struct stream *s, const uint8_t *eth, uint16_t len, uint16_t flags);

/*
 * Try to read a complete frame from stream's read buffer.
 * Call after reading from fd into s->rbuf.
 * Returns frame length (>0), 0 if incomplete, -1 on protocol error.
 */
int  frame_read(struct stream *s, uint8_t *buf, uint16_t *len, uint16_t *flags);

/* ── flow.c ────────────────────────────────────────────────────────────── */

int  flow_lookup(struct l2tap_ctx *ctx, const uint8_t *src, const uint8_t *dst);
int  flow_assign(struct l2tap_ctx *ctx, const uint8_t *src, const uint8_t *dst);
int  flow_assign_to(struct l2tap_ctx *ctx, const uint8_t *src, const uint8_t *dst, int stream_idx);
void flow_gc(struct l2tap_ctx *ctx);
void flow_remove_stream(struct l2tap_ctx *ctx, int stream_idx);
void flow_cleanup(struct l2tap_ctx *ctx);

/* ── stream.c ──────────────────────────────────────────────────────────── */

int  stream_listen(struct l2tap_ctx *ctx);
int  stream_accept(struct l2tap_ctx *ctx);
int  stream_connect(struct l2tap_ctx *ctx);
void stream_close(struct l2tap_ctx *ctx, int idx);
int  stream_flush(struct l2tap_ctx *ctx, int idx);
int  stream_find_free(struct l2tap_ctx *ctx);

/* ── loop.c ────────────────────────────────────────────────────────────── */

int  event_loop(struct l2tap_ctx *ctx);

/* ── log.c ─────────────────────────────────────────────────────────────── */

enum log_level { LOG_ERROR, LOG_WARN, LOG_INFO, LOG_DEBUG };

void log_set_verbose(int v);
void log_msg(enum log_level level, const char *fmt, ...)
    __attribute__((format(printf, 2, 3)));
void stats_dump(struct l2tap_ctx *ctx);
void stats_write_file(struct l2tap_ctx *ctx);

#define LOG_ERR(...)   log_msg(LOG_ERROR, __VA_ARGS__)
#define LOG_WARN(...)  log_msg(LOG_WARN, __VA_ARGS__)
#define LOG_INFO(...)  log_msg(LOG_INFO, __VA_ARGS__)
#define LOG_DBG(...)   log_msg(LOG_DEBUG, __VA_ARGS__)

#endif /* L2TAP_H */
