import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { ValidationPipe, Logger } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import * as Sentry from "@sentry/nestjs";
import redoc from "redoc-express";
import helmet from "helmet";
import { AppModule } from "@src/app.module";
import * as cookieParser from "cookie-parser";
import * as morgan from "morgan";
import * as passport from "passport";

async function bootstrap() {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENV || "localhost",
  });

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: {
      allowedHeaders: [
        "Content-Type",
        "Accept",
        "Authorization",
        "X-Requested-With",
      ],
      exposedHeaders: ["Content-Type", "Authorization"],
      origin: true,
      credentials: true,
      methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
      preflightContinue: false,
      optionsSuccessStatus: 204,
    },
    logger: ["error", "warn", "log"],
  });

  app.use(helmet());

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  if (process.env.MORGAN_LOG_FORMAT) {
    app.use(morgan(process.env.MORGAN_LOG_FORMAT));
  }

  if (process.env.PREFIX) {
    app.setGlobalPrefix(process.env.PREFIX);
  }

  if (process.env.SWAGGER_PREFIX) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle(process.env.SWAGGER_TITLE || "File Server API")
      .setDescription(
        process.env.SWAGGER_DESCRIPTION || "File upload and processing service",
      )
      .setVersion(process.env.SWAGGER_VERSION || "1.0")
      .build();
    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup(process.env.SWAGGER_PREFIX, app, swaggerDocument);
  }

  if (process.env.SWAGGER_PREFIX_REDOC) {
    const redocConfig = {
      title: process.env.SWAGGER_TITLE || "File Server API",
      version: process.env.SWAGGER_VERSION || "1.0",
      specUrl: `${process.env.SWAGGER_PREFIX}-json`,
    };
    app.use(`${process.env.SWAGGER_PREFIX_REDOC}`, redoc(redocConfig));
  }

  app.use(cookieParser());
  app.use(passport.initialize());

  const port = process.env.PORT || 3002;
  const ip = process.env.IP || "localhost";
  const logger = new Logger("Bootstrap");

  await app.listen(port, ip);
  logger.log(
    `File server running in ${process.env.NODE_ENV} mode on port ${port} at http://${ip}:${port}`,
  );

  process.on("SIGINT", () => {
    app.close();
  });
}

bootstrap().catch((err) => {
  console.error("Failed to start file server:", err);
  process.exit(1);
});
