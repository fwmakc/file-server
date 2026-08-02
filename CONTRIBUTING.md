# Contributing to file-server

Thanks for your interest in contributing! This service is part of the
[fwmakc microservices stack](https://github.com/fwmakc/gateway-server).

## Prerequisites

- **Node.js** 20+ (`node -v`)
- **npm** 10+
- **PostgreSQL** 14+ (or use Docker: `docker compose up -d postgres`)

## Development Setup

```bash
git clone https://github.com/fwmakc/file-server.git
cd file-server
cp .env.example .env
npm install
npm run dev
```

Service runs on port **3002**. Swagger UI at `http://localhost:3002/swagger`.

## Testing

```bash
npm test
```

7 test suites, 52 tests. Tests cover: upload handlers, image processing,
orchestrator pipeline, validation.

## Code Style

- TypeScript with strict type checking
- NestJS conventions (modules, controllers, services, DTOs)
- Use toolkit columns and guards
- Sharp for image processing, Puppeteer for PDF generation
- See `AGENTS.md` for detailed conventions

## Pull Request Process

1. Fork the repo, create a branch from `master`
2. Make your changes
3. Ensure tests pass: `npm test`
4. Ensure TypeScript compiles: `npm run build`
5. Create a pull request with a clear description
