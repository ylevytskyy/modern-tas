FROM python:3.12.7-alpine3.20
WORKDIR /app
COPY permission.py /app/permission.py
COPY healthcheck.py /app/healthcheck.py
RUN mkdir -p /var/log/permission
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=2s --retries=5 \
  CMD python3 /app/healthcheck.py
ENTRYPOINT ["python", "/app/permission.py"]
