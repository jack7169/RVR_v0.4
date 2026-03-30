#include "../include/l2tap.h"
#include <stdio.h>
#include <stdarg.h>
#include <time.h>
#include <string.h>

static int verbose_mode = 0;

static const char *level_str[] = {
    [LOG_ERROR] = "ERROR",
    [LOG_WARN]  = "WARN",
    [LOG_INFO]  = "INFO",
    [LOG_DEBUG] = "DEBUG",
};

void log_set_verbose(int v)
{
    verbose_mode = v;
}

void log_msg(enum log_level level, const char *fmt, ...)
{
    if (level == LOG_DEBUG && !verbose_mode)
        return;

    time_t now = time(NULL);
    struct tm *tm = localtime(&now);
    char ts[32];
    strftime(ts, sizeof(ts), "%Y-%m-%d %H:%M:%S", tm);

    fprintf(stderr, "l2tap[%s] %s: ", ts, level_str[level]);

    va_list ap;
    va_start(ap, fmt);
    vfprintf(stderr, fmt, ap);
    va_end(ap);

    fprintf(stderr, "\n");
    fflush(stderr);
}

void stats_dump(struct l2tap_ctx *ctx)
{
    LOG_INFO("=== l2tap stats ===");
    LOG_INFO("mode=%s streams=%d/%d flows=%d",
             ctx->cfg.mode == MODE_SERVER ? "server" : "client",
             ctx->stream_count, MAX_STREAMS, ctx->flow_count);
    LOG_INFO("tap: rx=%lu frames (%lu bytes) tx=%lu frames (%lu bytes)",
             (unsigned long)ctx->tap_rx_frames, (unsigned long)ctx->tap_rx_bytes,
             (unsigned long)ctx->tap_tx_frames, (unsigned long)ctx->tap_tx_bytes);

    for (int i = 0; i < MAX_STREAMS; i++) {
        struct stream *s = &ctx->streams[i];
        if (s->state == STREAM_FREE)
            continue;
        LOG_INFO("  stream[%d] fd=%d state=%s rx=%lu tx=%lu frames_rx=%lu frames_tx=%lu",
                 i, s->fd,
                 s->state == STREAM_ACTIVE ? "active" : "connecting",
                 (unsigned long)s->bytes_rx, (unsigned long)s->bytes_tx,
                 (unsigned long)s->frames_rx, (unsigned long)s->frames_tx);
    }
    LOG_INFO("===================");
}

void stats_write_file(struct l2tap_ctx *ctx)
{
    if (ctx->cfg.stats_file[0] == '\0')
        return;

    /* Write to temp file then rename for atomicity */
    char tmp[260];
    snprintf(tmp, sizeof(tmp), "%s.tmp", ctx->cfg.stats_file);

    FILE *f = fopen(tmp, "w");
    if (!f) {
        LOG_WARN("failed to write stats file: %s", tmp);
        return;
    }

    fprintf(f, "MODE=%s\n", ctx->cfg.mode == MODE_SERVER ? "server" : "client");
    fprintf(f, "STREAMS=%d\n", ctx->stream_count);
    fprintf(f, "MAX_STREAMS=%d\n", MAX_STREAMS);
    fprintf(f, "FLOWS=%d\n", ctx->flow_count);
    fprintf(f, "TAP_RX_FRAMES=%lu\n", (unsigned long)ctx->tap_rx_frames);
    fprintf(f, "TAP_RX_BYTES=%lu\n", (unsigned long)ctx->tap_rx_bytes);
    fprintf(f, "TAP_TX_FRAMES=%lu\n", (unsigned long)ctx->tap_tx_frames);
    fprintf(f, "TAP_TX_BYTES=%lu\n", (unsigned long)ctx->tap_tx_bytes);

    int bcast_up = 0;
    if (ctx->streams[0].state == STREAM_ACTIVE)
        bcast_up = 1;
    fprintf(f, "BCAST_STREAM=%s\n", bcast_up ? "up" : "down");

    for (int i = 0; i < MAX_STREAMS; i++) {
        struct stream *s = &ctx->streams[i];
        if (s->state == STREAM_FREE)
            continue;
        fprintf(f, "STREAM_%d_RX=%lu\n", i, (unsigned long)s->bytes_rx);
        fprintf(f, "STREAM_%d_TX=%lu\n", i, (unsigned long)s->bytes_tx);
    }

    fclose(f);
    rename(tmp, ctx->cfg.stats_file);
}
