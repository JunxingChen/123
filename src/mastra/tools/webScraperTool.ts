import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import axios from "axios";
import * as cheerio from "cheerio";
import crypto from "crypto";

export const webScraperTool = createTool({
  id: "web-scraper-tool",
  description: "Fetches and extracts content from a web page URL",
  
  inputSchema: z.object({
    url: z.string().url().describe("The URL to scrape"),
  }),
  
  outputSchema: z.object({
    url: z.string(),
    title: z.string(),
    content: z.string(),
    contentHash: z.string(),
    scrapedAt: z.string(),
  }),
  
  execute: async ({ context, mastra }) => {
    const logger = mastra?.getLogger();
    const { url } = context;
    
    logger?.info("🔧 [WebScraperTool] Starting to scrape URL", { url });
    
    try {
      const response = await axios.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        },
        timeout: 30000,
      });
      
      logger?.info("📥 [WebScraperTool] Successfully fetched URL", { 
        statusCode: response.status,
        contentLength: response.data.length 
      });
      
      const $ = cheerio.load(response.data);
      
      $("script, style, nav, footer, iframe, noscript").remove();
      
      let title = $("title").text().trim();
      if (!title) {
        title = $("h1").first().text().trim() || "Untitled";
      }
      
      let content = "";
      
      const newsItems = $(".news-list li, .news-item, article, .article, .content-item");
      if (newsItems.length > 0) {
        logger?.info("📰 [WebScraperTool] Found news items", { count: newsItems.length });
        newsItems.each((_, elem) => {
          const itemText = $(elem).text().trim();
          if (itemText) {
            content += itemText + "\n---\n";
          }
        });
      } else {
        const mainContent = $("main, article, .main-content, .content, body");
        content = mainContent.text().trim();
      }
      
      content = content
        .replace(/\s+/g, " ")
        .replace(/\n\s*\n/g, "\n")
        .trim();
      
      if (content.length > 50000) {
        content = content.substring(0, 50000) + "...";
      }
      
      const contentHash = crypto
        .createHash("md5")
        .update(content)
        .digest("hex");
      
      const scrapedAt = new Date().toISOString();
      
      logger?.info("✅ [WebScraperTool] Successfully scraped content", {
        url,
        titleLength: title.length,
        contentLength: content.length,
        contentHash,
      });
      
      return {
        url,
        title,
        content,
        contentHash,
        scrapedAt,
      };
    } catch (error: any) {
      logger?.error("❌ [WebScraperTool] Failed to scrape URL", {
        url,
        error: error.message,
      });
      
      throw new Error(`Failed to scrape URL ${url}: ${error.message}`);
    }
  },
});
