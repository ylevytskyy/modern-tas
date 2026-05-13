# S1 PoT — Asterisk image. Same Ubuntu 24.04 + asterisk approach as
# S3 (S3's image documented why andrius/asterisk and the other public
# tags can't be used: the andrius:22.9-current tag doesn't exist on
# Docker Hub, and the tags that do exist lack arm64 builds).
#
# S1 needs real SIP transport (PJSIP) because INVITEs arrive from
# Kamailio, unlike S3 which drove Stasis with Local channels via ARI.
FROM ubuntu:24.04

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      asterisk \
      asterisk-modules \
      tcpdump \
      iproute2 \
      curl && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Same /var/lib/asterisk ownership fix as S3 — see S3's Dockerfile
# header for why this is needed when cap_add gives NET_RAW.
RUN chown -R root:root /var/lib/asterisk /var/spool/asterisk /var/log/asterisk /var/run/asterisk 2>/dev/null || true

USER root
EXPOSE 5060/udp 5060/tcp 8088/tcp 10000-10999/udp

CMD ["/usr/sbin/asterisk", "-fvvvn"]
