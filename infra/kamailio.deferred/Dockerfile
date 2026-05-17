# infra/kamailio/Dockerfile — based on pot/S1-telephony-happy-path/kamailio-image/Dockerfile
# Kamailio 5.7.x from Ubuntu 24.04 distro package.
# kamailio-extra-modules includes rtpengine.so on Ubuntu 24.04.
# Module path: /usr/lib/<arch>/kamailio/modules/rtpengine.so (arch = aarch64-linux-gnu or x86_64-linux-gnu).
# The find check below covers both architectures.
FROM ubuntu:24.04

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      kamailio \
      kamailio-extra-modules \
      iproute2 \
      curl && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Verify rtpengine.so was installed (arch-agnostic: searches all of /usr/lib).
# Live-verified: installs to /usr/lib/<arch>/kamailio/modules/rtpengine.so on both arm64 and amd64.
RUN find /usr/lib -name "rtpengine.so" 2>/dev/null | grep -q rtpengine.so || \
    (echo "ERROR: rtpengine.so not found under /usr/lib. Add kamailio-rtpengine-modules or equivalent." && exit 1)

# The ctl module's unix socket lives in /var/run/kamailio/
RUN mkdir -p /var/run/kamailio && chmod 0755 /var/run/kamailio

EXPOSE 5060/udp 5060/tcp

ENTRYPOINT ["/usr/sbin/kamailio"]
CMD ["-DD", "-E", "-f", "/etc/kamailio/kamailio.cfg"]
