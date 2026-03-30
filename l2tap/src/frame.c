#include "../include/l2tap.h"
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <arpa/inet.h>

/*
 * Wire format per frame:
 *   [2 bytes] length (big-endian, payload only, excludes header)
 *   [2 bytes] flags  (big-endian)
 *   [N bytes] raw Ethernet frame
 */

int frame_write(struct stream *s, const uint8_t *eth, uint16_t len, uint16_t flags)
{
    (void)flags; /* flags field repurposed as sequence number */
    if (s->state != STREAM_ACTIVE)
        return -1;

    uint16_t seq = s->tx_seq++;
    uint8_t hdr[FRAME_HDR_LEN];
    hdr[0] = (len >> 8) & 0xFF;
    hdr[1] = len & 0xFF;
    hdr[2] = (seq >> 8) & 0xFF;
    hdr[3] = seq & 0xFF;

    size_t total = FRAME_HDR_LEN + len;

    /* Try direct write first if no pending buffered data */
    if (s->wlen == 0) {
        /* Build a single write with header + payload */
        uint8_t pkt[FRAME_HDR_LEN + MAX_FRAME_LEN];
        memcpy(pkt, hdr, FRAME_HDR_LEN);
        memcpy(pkt + FRAME_HDR_LEN, eth, len);

        ssize_t n = write(s->fd, pkt, total);
        if (n == (ssize_t)total) {
            s->bytes_tx += len;
            s->frames_tx++;
            return 0;
        }
        if (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK)
            return -1;

        /* Partial write or EAGAIN — buffer the remainder */
        size_t written = (n > 0) ? (size_t)n : 0;
        size_t remain = total - written;
        if (remain > WRITE_BUF_SIZE)
            return -1;  /* frame too large for buffer */

        memcpy(s->wbuf, pkt + written, remain);
        s->wlen = remain;
        s->bytes_tx += len;
        s->frames_tx++;
        return 1;  /* buffered */
    }

    /* Already have buffered data — append */
    if (s->wlen + total > WRITE_BUF_SIZE) {
        LOG_WARN("stream[%d] write buffer full, dropping frame (%zu bytes)", s->slot, total);
        return -1;
    }

    memcpy(s->wbuf + s->wlen, hdr, FRAME_HDR_LEN);
    memcpy(s->wbuf + s->wlen + FRAME_HDR_LEN, eth, len);
    s->wlen += total;
    s->bytes_tx += len;
    s->frames_tx++;
    return 1;  /* buffered */
}

int frame_read(struct stream *s, uint8_t *buf, uint16_t *len, uint16_t *flags)
{
    /* Need at least the header to determine frame length */
    if (s->rlen < FRAME_HDR_LEN)
        return 0;  /* incomplete */

    uint16_t flen = ((uint16_t)s->rbuf[0] << 8) | s->rbuf[1];
    uint16_t fflags = ((uint16_t)s->rbuf[2] << 8) | s->rbuf[3];

    /* Sanity check */
    if (flen == 0 || flen > MAX_FRAME_LEN) {
        LOG_ERR("stream[%d] invalid frame length: %u", s->slot, flen);
        return -1;  /* protocol error */
    }

    size_t total = FRAME_HDR_LEN + flen;
    if (s->rlen < total)
        return 0;  /* incomplete — need more data */

    /* Extract frame */
    memcpy(buf, s->rbuf + FRAME_HDR_LEN, flen);
    *len = flen;
    *flags = fflags;

    /* Shift remaining data in read buffer */
    size_t remaining = s->rlen - total;
    if (remaining > 0)
        memmove(s->rbuf, s->rbuf + total, remaining);
    s->rlen = remaining;

    s->bytes_rx += flen;
    s->frames_rx++;
    return flen;
}
