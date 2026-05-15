# S2 PoT — SIPp image. Debian bookworm ships `sip-tester` (SIPp 3.6.1)
# with arm64 + amd64 builds. The `ctaloi/sipp:3.7` image originally
# referenced in compose only has amd64 manifests, which fails to pull on
# Apple Silicon Docker Desktop hosts.
FROM debian:bookworm-slim

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      sip-tester \
      ca-certificates && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

ENTRYPOINT []
CMD ["sipp", "-h"]
