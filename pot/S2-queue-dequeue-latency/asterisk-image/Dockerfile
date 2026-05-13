# S2 PoT — Asterisk image. Ubuntu 24.04 ships Asterisk 20.6 in `universe`
# with arm64 + amd64 builds, which the otherwise-popular `andrius/asterisk`
# tags do not. Asterisk 20.x supports the same ARI / PJSIP / Stasis surface
# the spike needs; ADR-0024 doesn't pin a version.
FROM ubuntu:24.04

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      asterisk \
      asterisk-modules \
      asterisk-core-sounds-en \
      asterisk-moh-opsound-wav && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Run as root inside container — matches the runuser/rungroup in asterisk.conf.
USER root

EXPOSE 5060/udp 8088/tcp 10000-10999/udp

# -f foreground, -vvv verbose, -n no color codes (clean logs).
CMD ["/usr/sbin/asterisk", "-fvvvn"]
