import { Injectable } from "@nestjs/common";
import sharp = require("sharp");

@Injectable()
export class GetImageMetadataHandler {
  async getImageMetadata(file: Buffer) {
    return await sharp(file).metadata();
  }
}
