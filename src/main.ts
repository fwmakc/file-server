import { bootstrap } from "api-server-toolkit/bootstrap";
import { AppModule } from "@src/app.module";

bootstrap({
  module: AppModule,
  serviceName: "file-server",
  cors: true,
  morgan: true,
  cookieParser: true,
  passport: true,
});
