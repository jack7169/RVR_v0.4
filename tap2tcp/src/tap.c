#include "../include/tap2tcp.h"
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <linux/if.h>
#include <linux/if_tun.h>

int tap_open(const char *name)
{
    int fd = open("/dev/net/tun", O_RDWR | O_NONBLOCK);
    if (fd < 0) {
        LOG_ERR("open /dev/net/tun: %m");
        return -1;
    }

    struct ifreq ifr;
    memset(&ifr, 0, sizeof(ifr));
    ifr.ifr_flags = IFF_TAP | IFF_NO_PI;
    strncpy(ifr.ifr_name, name, IFNAMSIZ - 1);

    if (ioctl(fd, TUNSETIFF, &ifr) < 0) {
        LOG_ERR("ioctl TUNSETIFF (%s): %m", name);
        close(fd);
        return -1;
    }

    LOG_INFO("opened TAP interface: %s (fd=%d)", ifr.ifr_name, fd);
    return fd;
}

int tap_set_mtu(const char *name, int mtu)
{
    int sock = socket(AF_INET, SOCK_DGRAM, 0);
    if (sock < 0) {
        LOG_ERR("socket: %m");
        return -1;
    }

    struct ifreq ifr;
    memset(&ifr, 0, sizeof(ifr));
    strncpy(ifr.ifr_name, name, IFNAMSIZ - 1);
    ifr.ifr_mtu = mtu;

    int ret = ioctl(sock, SIOCSIFMTU, &ifr);
    if (ret < 0)
        LOG_ERR("ioctl SIOCSIFMTU (%s, %d): %m", name, mtu);
    else
        LOG_INFO("set %s MTU to %d", name, mtu);

    close(sock);
    return ret;
}

int tap_set_up(const char *name)
{
    int sock = socket(AF_INET, SOCK_DGRAM, 0);
    if (sock < 0) {
        LOG_ERR("socket: %m");
        return -1;
    }

    struct ifreq ifr;
    memset(&ifr, 0, sizeof(ifr));
    strncpy(ifr.ifr_name, name, IFNAMSIZ - 1);

    if (ioctl(sock, SIOCGIFFLAGS, &ifr) < 0) {
        LOG_ERR("ioctl SIOCGIFFLAGS (%s): %m", name);
        close(sock);
        return -1;
    }

    ifr.ifr_flags |= IFF_UP | IFF_RUNNING;

    int ret = ioctl(sock, SIOCSIFFLAGS, &ifr);
    if (ret < 0)
        LOG_ERR("ioctl SIOCSIFFLAGS (%s): %m", name);
    else
        LOG_INFO("interface %s is up", name);

    close(sock);
    return ret;
}
