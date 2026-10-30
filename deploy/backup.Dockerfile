FROM node:24-bookworm-slim AS node-runtime
FROM postgres:17-bookworm
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
RUN apt-get update && apt-get install -y --no-install-recommends libatomic1 && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /backups /reports /operations && chown postgres:postgres /backups /reports && chmod 700 /backups /reports
COPY deploy/backup-*.mjs /operations/
USER postgres
ENTRYPOINT []
CMD ["node", "/operations/backup-cli.mjs", "schedule"]
