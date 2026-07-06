FROM node:18-alpine

WORKDIR /task

# Run as the non-root "node" user baked into the official image — never root
# inside the sandbox, even though NetworkMode/ReadonlyRootfs already do most
# of the real containment work.
RUN chown node:node /task
USER node

ENTRYPOINT ["node"]