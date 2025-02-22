FROM oven/bun:latest AS build

LABEL org.opencontainers.image.source="https://github.com/EVE-KILL/ImageServer"

# Set the working directory
WORKDIR /app

# Copy the code
COPY . /app

# Install dependencies and build application
RUN \
    apt update && \
    apt install -y unzip && \
    bun install && \
    bun run build && \
    bun --bun run ./updateImageDump.ts && \
    # Cleanup apt
    apt remove -y unzip && \
    apt autoremove -y && \
    rm -rf /var/lib/apt/lists/*

# Expose the port
EXPOSE 3000

CMD [ "bun", "--bun", "run", "/app/.output/server/index.mjs" ]
