import { Injectable, Logger } from "@nestjs/common";
import { readFile } from "fs/promises";
import { join } from "path";
import { v4 } from "uuid";
import * as puppeteer from "puppeteer";
import * as ejs from "ejs";

@Injectable()
export class PdfGenerateHandler {
  private readonly logger = new Logger(PdfGenerateHandler.name);

  async pdfGenerate(
    template: string,
    data: object = {},
    options: puppeteer.PDFOptions = {},
    isFile = false
  ) {
    const filePath = join(process.cwd(), "views/pdf", `${template}.ejs`);
    const fileOutput = join(
      process.cwd(),
      `public/generated/${template}`,
      `${v4()}.pdf`
    );

    const browser = await puppeteer.launch();
    try {
      const page = await browser.newPage();

      const html = await readFile(filePath, { encoding: "utf8" });
      const content = ejs.render(html, data);

      await page.setContent(content);

      options = {
        path: isFile ? fileOutput : undefined,
        format: "A4",
        printBackground: true,
        displayHeaderFooter: false,
        landscape: false,
        margin: {
          left: "0mm",
          top: "0mm",
          right: "0mm",
          bottom: "0mm",
        },
        ...options,
      };

      const buffer = await page.pdf(options);
      return isFile ? fileOutput : buffer;
    } catch (e) {
      this.logger.error(`PDF generation failed for template "${template}": ${e.message}`, e.stack);
      throw e;
    } finally {
      await browser.close();
    }
  }
}
