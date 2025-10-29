import { createStep, createWorkflow } from "../inngest";
import { z } from "zod";
import { webScraperTool } from "../tools/webScraperTool";
import { RuntimeContext } from "@mastra/core/di";
import { Pool } from "pg";

const runtimeContext = new RuntimeContext();

const getTargetUrlStep = createStep({
  id: "get-target-url",
  description: "Get the target URL from database configuration",
  
  inputSchema: z.object({
    dummy: z.string().optional(),
  }),
  
  outputSchema: z.object({
    url: z.string(),
  }),
  
  execute: async ({ mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("📝 [GetTargetUrl] Fetching target URL from configuration");
    
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
    
    try {
      const result = await pool.query(
        "SELECT config_value FROM scraper_config WHERE config_key = 'target_url'"
      );
      
      const url = result.rows[0]?.config_value || "https://www.jin10.com/";
      
      logger?.info("✅ [GetTargetUrl] Target URL retrieved", { url });
      
      return { url };
    } catch (error: any) {
      logger?.error("❌ [GetTargetUrl] Failed to get target URL", { error: error.message });
      logger?.info("ℹ️  [GetTargetUrl] Using default URL");
      return { url: "https://www.jin10.com/" };
    } finally {
      await pool.end();
    }
  },
});

const scrapeContentStep = createStep({
  id: "scrape-content",
  description: "Scrape content from the target URL",
  
  inputSchema: z.object({
    url: z.string(),
  }),
  
  outputSchema: z.object({
    url: z.string(),
    title: z.string(),
    content: z.string(),
    contentHash: z.string(),
    scrapedAt: z.string(),
  }),
  
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const { url } = inputData;
    
    logger?.info("🌐 [ScrapeContent] Starting to scrape URL", { url });
    
    const result = await webScraperTool.execute({
      context: { url },
      runtimeContext,
      mastra,
    });
    
    logger?.info("✅ [ScrapeContent] Successfully scraped content", {
      url: result.url,
      titleLength: result.title.length,
      contentLength: result.content.length,
    });
    
    return result;
  },
});

const storeContentStep = createStep({
  id: "store-content",
  description: "Store scraped content in database with deduplication",
  
  inputSchema: z.object({
    url: z.string(),
    title: z.string(),
    content: z.string(),
    contentHash: z.string(),
    scrapedAt: z.string(),
  }),
  
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    isNew: z.boolean(),
  }),
  
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    const { url, title, content, contentHash, scrapedAt } = inputData;
    
    logger?.info("💾 [StoreContent] Storing content in database", {
      url,
      contentHash,
    });
    
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
    
    try {
      const insertResult = await pool.query(
        `INSERT INTO scraped_content (url, title, content, content_hash, scraped_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (content_hash) DO NOTHING
         RETURNING id`,
        [url, title, content, contentHash, scrapedAt]
      );
      
      if (insertResult.rows.length === 0) {
        logger?.info("ℹ️  [StoreContent] Content already exists (duplicate)", {
          contentHash,
        });
        
        return {
          success: true,
          message: "Content already exists (duplicate)",
          isNew: false,
        };
      }
      
      logger?.info("✅ [StoreContent] Successfully stored new content", {
        id: insertResult.rows[0].id,
        contentHash,
      });
      
      return {
        success: true,
        message: `Successfully stored new content with ID ${insertResult.rows[0].id}`,
        isNew: true,
      };
    } catch (error: any) {
      logger?.error("❌ [StoreContent] Failed to store content", {
        error: error.message,
      });
      
      return {
        success: false,
        message: `Failed to store content: ${error.message}`,
        isNew: false,
      };
    } finally {
      await pool.end();
    }
  },
});

export const scrapingWorkflow = createWorkflow({
  id: "scraping-workflow",
  description: "Periodically scrapes content from configured URL and stores it in database",
  
  inputSchema: z.object({
    dummy: z.string().optional(),
  }),
  
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    isNew: z.boolean(),
  }),
})
  .then(getTargetUrlStep)
  .then(scrapeContentStep)
  .then(storeContentStep)
  .commit();
