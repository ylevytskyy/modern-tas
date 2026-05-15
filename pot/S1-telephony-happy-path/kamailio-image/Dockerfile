# S1 PoT — Kamailio image. The original scaffold's
# ghcr.io/kamailio/kamailio:6.0.0-alpine doesn't exist (same trap
# as andrius/asterisk in S2/S3 and ctaloi/sipp in S2).
#
# Building locally on Ubuntu 24.04 with the distro's kamailio package
# (5.7.x at time of writing). ARCH v0.4 calls for 6.x but for the
# topology validation S1 is doing — stateless proxy with dispatcher
# module + OPTIONS keepalive — the 5.x and 6.x module surfaces are
# identical. If a 6.x-specific feature is needed later we can swap to
# the deb.kamailio.org repo.
FROM ubuntu:24.04

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      kamailio \
      kamailio-extra-modules \
      iproute2 \
      curl && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# The ctl module's unix socket lives in /var/run/kamailio/ — the
# Debian/Ubuntu package creates it via tmpfiles.d when run under
# systemd. We run kamailio directly, so create the dir explicitly.
RUN mkdir -p /var/run/kamailio && chmod 0755 /var/run/kamailio

# The default /etc/kamailio/kamctlrc and /etc/kamailio/kamailio.cfg are
# left in place but our compose mounts our cfg over the top.

EXPOSE 5060/udp 5060/tcp

ENTRYPOINT ["/usr/sbin/kamailio"]
CMD ["-DD", "-E", "-f", "/etc/kamailio/kamailio.cfg"]
