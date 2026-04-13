# -----------------------------------------------------------
# Stage 1: Build backend (TypeScript → dist/)
# -----------------------------------------------------------
FROM node:20-alpine AS backend-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src/ src/
COPY tsconfig.json ./
RUN npm run build

# -----------------------------------------------------------
# Stage 2: Build frontend (Next.js standalone)
# -----------------------------------------------------------
FROM node:20-alpine AS web-build
WORKDIR /app/apps/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web/ ./
# Enable standalone output for Docker-friendly deployment
RUN sed -i 's/const nextConfig: NextConfig = {/const nextConfig: NextConfig = {\n  output: "standalone",/' next.config.ts
ENV NEXT_PUBLIC_API_URL=http://localhost:3849
RUN npx next build

# -----------------------------------------------------------
# Stage 3: Production runtime
# -----------------------------------------------------------
FROM node:20-alpine
WORKDIR /app

# Backend artifacts
COPY --from=backend-build /app/dist dist/
COPY --from=backend-build /app/node_modules node_modules/
COPY --from=backend-build /app/package.json .

# Frontend artifacts (standalone build)
COPY --from=web-build /app/apps/web/.next/standalone apps/web/
COPY --from=web-build /app/apps/web/.next/static apps/web/.next/static/
COPY --from=web-build /app/apps/web/public apps/web/public/

# Config + personas (needed at runtime)
COPY config/ config/
COPY personas/ personas/

# State directories created at runtime via volume mounts
RUN mkdir -p /root/.anc /root/anc-workspaces

ENV NODE_ENV=production
EXPOSE 3849 3000

CMD ["sh", "-c", "node dist/index.js serve & node apps/web/server.js"]
