#include "../include/l2tap.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include <unistd.h>
#include <getopt.h>
#include <sys/epoll.h>

static struct l2tap_ctx g_ctx;

static void usage(const char *prog)
{
    fprintf(stderr,
        "Usage: %s [options]\n"
        "\n"
        "Options:\n"
        "  -m <mode>     Operating mode: 'server' or 'client' (required)\n"
        "  -l <addr>     Listen address (server mode, default: 127.0.0.1:655)\n"
        "  -c <addr>     Connect address (client mode, default: 127.0.0.1:4001)\n"
        "  -t <name>     TAP interface name (default: l2bridge)\n"
        "  -u <script>   Up script (run after TAP creation)\n"
        "  -d <script>   Down script (run before shutdown)\n"
        "  -s <file>     Stats file path (default: /tmp/l2tap.stats)\n"
        "  -L <ms>       Soft latency cut — warn when frame age exceeds this (default: 1000)\n"
        "  -H <ms>       Hard latency cut — drop frames older than this (default: 2000)\n"
        "  -v            Verbose logging\n"
        "  -h            Show this help\n"
        "\n"
        "Server mode (GCS):     l2tap -m server -l 127.0.0.1:655\n"
        "Client mode (Aircraft): l2tap -m client -c 127.0.0.1:4001\n"
        , prog);
}

static int parse_addr(const char *s, char *host, size_t hlen, int *port)
{
    const char *colon = strrchr(s, ':');
    if (!colon) {
        fprintf(stderr, "invalid address (expected host:port): %s\n", s);
        return -1;
    }

    size_t hostlen = colon - s;
    if (hostlen >= hlen)
        hostlen = hlen - 1;
    memcpy(host, s, hostlen);
    host[hostlen] = '\0';

    *port = atoi(colon + 1);
    if (*port <= 0 || *port > 65535) {
        fprintf(stderr, "invalid port: %s\n", colon + 1);
        return -1;
    }
    return 0;
}

static void signal_handler(int sig)
{
    if (sig == SIGTERM || sig == SIGINT) {
        g_ctx.running = 0;
    } else if (sig == SIGUSR1) {
        stats_dump(&g_ctx);
    }
}

static void run_script(const char *path)
{
    if (path[0] == '\0')
        return;

    LOG_INFO("running script: %s", path);
    int ret = system(path);
    if (ret != 0)
        LOG_WARN("script %s exited with %d", path, ret);
}

int main(int argc, char *argv[])
{
    memset(&g_ctx, 0, sizeof(g_ctx));
    g_ctx.cfg.mode = -1;
    strncpy(g_ctx.cfg.tap_name, "l2bridge", sizeof(g_ctx.cfg.tap_name) - 1);
    strncpy(g_ctx.cfg.stats_file, "/tmp/l2tap.stats", sizeof(g_ctx.cfg.stats_file) - 1);
    g_ctx.cfg.soft_latency_ms = 1000;
    g_ctx.cfg.hard_latency_ms = 2000;

    /* Default addresses */
    strncpy(g_ctx.cfg.listen_addr, "127.0.0.1", sizeof(g_ctx.cfg.listen_addr) - 1);
    g_ctx.cfg.listen_port = 655;
    strncpy(g_ctx.cfg.connect_addr, "127.0.0.1", sizeof(g_ctx.cfg.connect_addr) - 1);
    g_ctx.cfg.connect_port = 4001;

    int opt;
    while ((opt = getopt(argc, argv, "m:l:c:t:u:d:s:L:H:vh")) != -1) {
        switch (opt) {
        case 'm':
            if (strcmp(optarg, "server") == 0)
                g_ctx.cfg.mode = MODE_SERVER;
            else if (strcmp(optarg, "client") == 0)
                g_ctx.cfg.mode = MODE_CLIENT;
            else {
                fprintf(stderr, "invalid mode: %s\n", optarg);
                return 1;
            }
            break;
        case 'l':
            if (parse_addr(optarg, g_ctx.cfg.listen_addr,
                           sizeof(g_ctx.cfg.listen_addr),
                           &g_ctx.cfg.listen_port) < 0)
                return 1;
            break;
        case 'c':
            if (parse_addr(optarg, g_ctx.cfg.connect_addr,
                           sizeof(g_ctx.cfg.connect_addr),
                           &g_ctx.cfg.connect_port) < 0)
                return 1;
            break;
        case 't':
            strncpy(g_ctx.cfg.tap_name, optarg,
                    sizeof(g_ctx.cfg.tap_name) - 1);
            break;
        case 'u':
            strncpy(g_ctx.cfg.up_script, optarg,
                    sizeof(g_ctx.cfg.up_script) - 1);
            break;
        case 'd':
            strncpy(g_ctx.cfg.down_script, optarg,
                    sizeof(g_ctx.cfg.down_script) - 1);
            break;
        case 's':
            strncpy(g_ctx.cfg.stats_file, optarg,
                    sizeof(g_ctx.cfg.stats_file) - 1);
            break;
        case 'L':
            g_ctx.cfg.soft_latency_ms = atoi(optarg);
            break;
        case 'H':
            g_ctx.cfg.hard_latency_ms = atoi(optarg);
            break;
        case 'v':
            g_ctx.cfg.verbose = 1;
            break;
        case 'h':
            usage(argv[0]);
            return 0;
        default:
            usage(argv[0]);
            return 1;
        }
    }

    if (g_ctx.cfg.mode < 0) {
        fprintf(stderr, "error: -m server|client is required\n");
        usage(argv[0]);
        return 1;
    }

    log_set_verbose(g_ctx.cfg.verbose);

    LOG_INFO("l2tap starting (mode=%s tap=%s)",
             g_ctx.cfg.mode == MODE_SERVER ? "server" : "client",
             g_ctx.cfg.tap_name);

    /* Initialize streams */
    for (int i = 0; i < MAX_STREAMS; i++) {
        g_ctx.streams[i].fd = -1;
        g_ctx.streams[i].state = STREAM_FREE;
        g_ctx.streams[i].slot = i;
    }

    /* Create epoll instance */
    g_ctx.epoll_fd = epoll_create1(0);
    if (g_ctx.epoll_fd < 0) {
        LOG_ERR("epoll_create1: %m");
        return 1;
    }

    /* Open TAP interface */
    g_ctx.tap_fd = tap_open(g_ctx.cfg.tap_name);
    if (g_ctx.tap_fd < 0) {
        LOG_ERR("failed to open TAP interface");
        return 1;
    }

    /* Add TAP to epoll */
    struct epoll_event ev = {
        .events = EPOLLIN,
        .data.fd = g_ctx.tap_fd,
    };
    if (epoll_ctl(g_ctx.epoll_fd, EPOLL_CTL_ADD, g_ctx.tap_fd, &ev) < 0) {
        LOG_ERR("epoll_ctl add tap: %m");
        return 1;
    }

    /* Run up script (bridge join, nftables, etc.) */
    run_script(g_ctx.cfg.up_script);

    /* Server mode: start listening */
    if (g_ctx.cfg.mode == MODE_SERVER) {
        if (stream_listen(&g_ctx) < 0) {
            LOG_ERR("failed to start listener");
            run_script(g_ctx.cfg.down_script);
            return 1;
        }
    }

    /* Install signal handlers */
    signal(SIGTERM, signal_handler);
    signal(SIGINT, signal_handler);
    signal(SIGUSR1, signal_handler);
    signal(SIGPIPE, SIG_IGN);

    g_ctx.running = 1;
    g_ctx.last_gc = time(NULL);
    g_ctx.last_stats = time(NULL);

    /* Enter main event loop */
    int ret = event_loop(&g_ctx);

    /* Cleanup */
    LOG_INFO("shutting down");

    /* Close all streams */
    for (int i = 0; i < MAX_STREAMS; i++) {
        if (g_ctx.streams[i].state != STREAM_FREE)
            stream_close(&g_ctx, i);
    }

    /* Close listen socket */
    if (g_ctx.listen_fd > 0)
        close(g_ctx.listen_fd);

    /* Free flow table */
    flow_cleanup(&g_ctx);

    /* Run down script */
    run_script(g_ctx.cfg.down_script);

    /* Close TAP */
    close(g_ctx.tap_fd);
    close(g_ctx.epoll_fd);

    /* Write final stats */
    stats_write_file(&g_ctx);

    LOG_INFO("l2tap stopped");
    return ret;
}
