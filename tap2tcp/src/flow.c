#include "../include/tap2tcp.h"
#include <stdlib.h>
#include <string.h>
#include <time.h>

/* FNV-1a hash over 12-byte MAC pair key */
static uint32_t flow_hash(const uint8_t *src, const uint8_t *dst)
{
    uint32_t h = 2166136261u;
    for (int i = 0; i < MAC_LEN; i++) {
        h ^= src[i];
        h *= 16777619u;
    }
    for (int i = 0; i < MAC_LEN; i++) {
        h ^= dst[i];
        h *= 16777619u;
    }
    return h % FLOW_BUCKETS;
}

static int mac_pair_eq(const struct flow_entry *e,
                       const uint8_t *src, const uint8_t *dst)
{
    return memcmp(e->src_mac, src, MAC_LEN) == 0 &&
           memcmp(e->dst_mac, dst, MAC_LEN) == 0;
}

int flow_lookup(struct tap2tcp_ctx *ctx, const uint8_t *src, const uint8_t *dst)
{
    uint32_t bucket = flow_hash(src, dst);
    struct flow_entry *e = ctx->flow_table[bucket];

    while (e) {
        if (mac_pair_eq(e, src, dst)) {
            e->last_seen = time(NULL);
            return e->stream_idx;
        }
        e = e->next;
    }
    return -1;  /* not found */
}

int flow_assign_to(struct tap2tcp_ctx *ctx, const uint8_t *src, const uint8_t *dst, int stream_idx)
{
    struct flow_entry *e = calloc(1, sizeof(*e));
    if (!e) {
        LOG_ERR("flow_assign_to: calloc failed");
        return -1;
    }

    memcpy(e->src_mac, src, MAC_LEN);
    memcpy(e->dst_mac, dst, MAC_LEN);
    e->stream_idx = stream_idx;
    e->last_seen = time(NULL);

    uint32_t bucket = flow_hash(src, dst);
    e->next = ctx->flow_table[bucket];
    ctx->flow_table[bucket] = e;
    ctx->flow_count++;

    LOG_DBG("flow assigned: %02x:%02x:%02x:%02x:%02x:%02x -> "
            "%02x:%02x:%02x:%02x:%02x:%02x => stream[%d]",
            src[0], src[1], src[2], src[3], src[4], src[5],
            dst[0], dst[1], dst[2], dst[3], dst[4], dst[5],
            stream_idx);

    return stream_idx;
}

int flow_assign(struct tap2tcp_ctx *ctx, const uint8_t *src, const uint8_t *dst)
{
    int idx = stream_find_free(ctx);
    if (idx < 0) {
        LOG_WARN("no free stream slots (max %d)", MAX_STREAMS);
        return -1;
    }
    return flow_assign_to(ctx, src, dst, idx);
}

void flow_gc(struct tap2tcp_ctx *ctx)
{
    time_t now = time(NULL);

    for (int b = 0; b < FLOW_BUCKETS; b++) {
        struct flow_entry **pp = &ctx->flow_table[b];
        while (*pp) {
            struct flow_entry *e = *pp;
            /* Never GC stream 0 (broadcast/multicast) */
            if (e->stream_idx != 0 &&
                (now - e->last_seen) > IDLE_TIMEOUT) {
                LOG_DBG("flow gc: stream[%d] idle %lds",
                        e->stream_idx, (long)(now - e->last_seen));
                /* Close the associated stream */
                stream_close(ctx, e->stream_idx);
                *pp = e->next;
                free(e);
                ctx->flow_count--;
            } else {
                pp = &e->next;
            }
        }
    }
}

void flow_remove_stream(struct tap2tcp_ctx *ctx, int stream_idx)
{
    for (int b = 0; b < FLOW_BUCKETS; b++) {
        struct flow_entry **pp = &ctx->flow_table[b];
        while (*pp) {
            struct flow_entry *e = *pp;
            if (e->stream_idx == stream_idx) {
                *pp = e->next;
                free(e);
                ctx->flow_count--;
            } else {
                pp = &e->next;
            }
        }
    }
}

void flow_cleanup(struct tap2tcp_ctx *ctx)
{
    for (int b = 0; b < FLOW_BUCKETS; b++) {
        struct flow_entry *e = ctx->flow_table[b];
        while (e) {
            struct flow_entry *next = e->next;
            free(e);
            e = next;
        }
        ctx->flow_table[b] = NULL;
    }
    ctx->flow_count = 0;
}
