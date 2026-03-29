import * as lark from '@larksuiteoapi/node-sdk';
import { HttpsProxyAgent } from 'https-proxy-agent';
import * as fs from 'fs';
import * as path from 'path';
import { ASSISTANT_NAME, GROUPS_DIR } from '../config.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { Channel, NewMessage } from '../types.js';
import { registerChannel, ChannelOpts } from './registry.js';

function getProxyAgent(): HttpsProxyAgent<string> | undefined {
  const proxy =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;
  if (!proxy) return undefined;
  return new HttpsProxyAgent(proxy);
}

// Fix filename encoding - when UTF-8 Chinese is interpreted as Latin-1, it becomes garbled.
// This attempts to recover the original filename.
function fixFilenameEncoding(filename: string): string {
  // If filename looks like garbled Chinese (contains characters from Latin-1 extended set
  // that are unlikely to be actual French/Spanish/etc text), try to recover UTF-8
  try {
    // Convert the string back to bytes assuming it's Latin-1, then decode as UTF-8
    const bytes = Buffer.from(filename, 'latin1');
    const decoded = bytes.toString('utf8');
    // Check if decoded result contains valid Chinese characters
    if (/[\u4e00-\u9fff]/.test(decoded)) {
      return decoded;
    }
  } catch {
    // Ignore errors, return original
  }
  return filename;
}

const JID_PREFIX = 'feishu:';

function toJid(chatId: string): string {
  return `${JID_PREFIX}${chatId}`;
}

function toChatId(jid: string): string {
  return jid.slice(JID_PREFIX.length);
}

class FeishuChannel implements Channel {
  name = 'feishu';
  private client: InstanceType<typeof lark.Client>;
  private wsClient: lark.WSClient | null = null;
  private dispatcher: lark.EventDispatcher;
  private connected = false;
  private botOpenId: string | null = null;
  private opts: ChannelOpts;
  private lastOcrTime = 0;
  private ocrQueue: Array<{
    messageId: string;
    base64: string;
    resolve: (text: string | undefined) => void;
  }> = [];
  private ocrProcessing = false;

  constructor(
    private appId: string,
    private appSecret: string,
    opts: ChannelOpts,
  ) {
    this.opts = opts;

    this.client = new lark.Client({
      appId,
      appSecret,
      domain: lark.Domain.Feishu,
    });

    this.dispatcher = new lark.EventDispatcher({});
    this.dispatcher.register({
      'im.message.receive_v1': (data) => this.handleMessage(data),
      'im.chat.member.bot.added_v1': (data) => this.handleBotAddedToGroup(data),
    });
  }

  async connect(): Promise<void> {
    logger.info('Feishu channel connecting...');
    // Get bot info for filtering self-messages
    try {
      const botInfo = await this.client.request({
        method: 'GET',
        url: 'https://open.feishu.cn/open-apis/bot/v3/info',
      });
      if (botInfo?.bot?.open_id) {
        this.botOpenId = botInfo.bot.open_id;
        logger.info({ botOpenId: this.botOpenId }, 'Feishu bot info loaded');
      }
    } catch (err) {
      logger.warn(
        { err },
        'Failed to get Feishu bot info, self-message filtering may not work',
      );
    }

    const agent = getProxyAgent();
    this.wsClient = new lark.WSClient({
      appId: this.appId,
      appSecret: this.appSecret,
      domain: lark.Domain.Feishu,
      ...(agent ? { agent } : {}),
    });

    await this.wsClient.start({ eventDispatcher: this.dispatcher });
    this.connected = true;
    logger.info('Feishu channel connected via WebSocket');
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    const chatId = toChatId(jid);
    // Feishu has a 4000-char limit per message, split if needed
    const chunks = splitMessage(text, 4000);
    for (const chunk of chunks) {
      await this.client.im.message.create({
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text: chunk }),
        },
        params: { receive_id_type: 'chat_id' },
      });
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith(JID_PREFIX);
  }

  async disconnect(): Promise<void> {
    if (this.wsClient) {
      this.wsClient.close();
      this.wsClient = null;
    }
    this.connected = false;
    logger.info('Feishu channel disconnected');
  }

  private async handleBotAddedToGroup(data: any): Promise<void> {
    logger.info(
      { rawData: data },
      'Bot added event received - debugging data structure',
    );

    // Based on the log you showed, the structure is different
    // Let's extract chat_id from the correct location
    let chatId: string | null = null;

    // Try different possible structures
    if (data.event && data.event.chat_id) {
      chatId = data.event.chat_id;
    } else if (data.chat_id) {
      chatId = data.chat_id;
    } else if (data.event && typeof data.event === 'object') {
      // Look for chat_id in the event object properties
      for (const key in data.event) {
        if (key.includes('chat') || key.includes('Chat')) {
          chatId = data.event[key];
          break;
        }
      }
    }

    if (chatId) {
      logger.info(
        { chatId, eventType: 'im.chat.member.bot.added_v1' },
        'Bot was added to group!',
      );

      // Convert chat ID to JID format and register the group automatically
      const chatJid = toJid(chatId);
      logger.info({ chatJid }, 'Auto-registering new group...');

      // Create a temporary registration message to trigger group setup
      setTimeout(() => {
        logger.info(
          { chatJid },
          'Would auto-register group here - for now just logging',
        );
      }, 1000);
    } else {
      logger.warn({ data }, 'Could not find chat_id in bot added event');
    }
  }

  private async handleMessage(data: {
    sender: {
      sender_id?: { open_id?: string; user_id?: string; union_id?: string };
      sender_type: string;
    };
    message: {
      message_id: string;
      chat_id: string;
      chat_type: string;
      message_type: string;
      content: string;
      create_time: string;
      mentions?: Array<{ key: string; id: { open_id?: string }; name: string }>;
    };
  }): Promise<void> {
    const { sender, message } = data;
    logger.info(
      { chatId: message.chat_id, chatType: message.chat_type },
      'Feishu message received',
    );
    const openId = sender.sender_id?.open_id || '';

    // Skip messages from the bot itself
    if (this.botOpenId && openId === this.botOpenId) return;

    const isGroup = message.chat_type === 'group';

    // Add "了解" reaction to group messages
    if (isGroup) {
      this.addReaction(message.message_id).catch((err) =>
        logger.warn(
          { err, messageId: message.message_id },
          'Failed to add 了解 reaction',
        ),
      );
    }

    // Handle image messages (only images, no text)
    if (message.message_type === 'image') {
      logger.debug(
        { messageId: message.message_id, chatId: message.chat_id },
        'Feishu: processing image message',
      );
      const imageResult = await this.downloadImage(
        message.message_id,
        message.content,
      );
      if (imageResult) {
        const chatJid = toJid(message.chat_id);
        const ts = new Date(Number(message.create_time)).toISOString();
        this.opts.onChatMetadata(chatJid, ts, undefined, 'feishu', isGroup);

        // OCR 成功或失败都只发文字，不发图片
        const content = imageResult.ocrText
          ? `[图片文字识别结果: ${imageResult.ocrText}]`
          : '[OCR服务失败，请稍后再试]';

        const msg: NewMessage = {
          id: message.message_id,
          chat_jid: chatJid,
          sender: openId,
          sender_name: openId,
          content,
          timestamp: ts,
          is_from_me: false,
          is_bot_message: sender.sender_type === 'app',
        };
        this.opts.onMessage(chatJid, msg);
      }
      return;
    }

    // Handle file messages (Excel, PDF, etc.)
    if (message.message_type === 'file') {
      logger.debug(
        { messageId: message.message_id, chatId: message.chat_id },
        'Feishu: processing file message',
      );
      const fileResult = await this.downloadFile(
        message.message_id,
        message.content,
      );
      if (fileResult) {
        const chatJid = toJid(message.chat_id);
        const ts = new Date(Number(message.create_time)).toISOString();
        this.opts.onChatMetadata(chatJid, ts, undefined, 'feishu', isGroup);

        // Look up group by chatJid directly
        const groups = this.opts.registeredGroups();
        const groupEntry = groups[chatJid];
        let containerPath = '';
        if (groupEntry) {
          // Save file to group directory /workspace/group/files/
          const groupDir = path.join(GROUPS_DIR, groupEntry.folder);
          const filesDir = path.join(groupDir, 'files');
          fs.mkdirSync(filesDir, { recursive: true });
          const ext = path.extname(fileResult.filename) || '.xlsx';
          const savedFilename = `${message.message_id}${ext}`;
          const filePath = path.join(filesDir, savedFilename);
          const buffer = Buffer.from(fileResult.base64, 'base64');
          fs.writeFileSync(filePath, buffer);
          // Container path: /workspace/group/files/filename
          containerPath = `/workspace/group/files/${savedFilename}`;
          logger.info(
            { filePath, containerPath, originalFilename: fileResult.filename },
            'Feishu file saved to group directory',
          );
        } else {
          logger.warn(
            { chatJid },
            'Group not found for chatJid when saving file',
          );
        }

        const msg: NewMessage = {
          id: message.message_id,
          chat_jid: chatJid,
          sender: openId,
          sender_name: openId,
          content: containerPath
            ? `[文件: ${fileResult.filename}]\n路径: ${containerPath}`
            : `[文件: ${fileResult.filename}]`,
          timestamp: ts,
          is_from_me: false,
          is_bot_message: sender.sender_type === 'app',
          attachments: [
            {
              type: 'file',
              data: fileResult.base64,
              mimeType: fileResult.mimeType,
              filename: fileResult.filename,
            },
          ],
        };
        this.opts.onMessage(chatJid, msg);
      }
      return;
    }

    // Handle post messages (rich text with possible images + text)
    if (message.message_type === 'post') {
      let parsed;
      try {
        parsed = JSON.parse(message.content);
      } catch (err) {
        logger.warn(
          { err, messageId: message.message_id },
          'Failed to parse post content',
        );
        return;
      }
      let text = '';
      const images: { base64: string; mimeType: string; ocrText?: string }[] =
        [];

      // Parse post content - structure is: { title: "", content: [[{ tag: "img"|"text"|"at", ... }]] }
      const postContent = parsed.content || [];
      logger.debug(
        {
          messageId: message.message_id,
          postContentLength: postContent.length,
        },
        'Post content parsed',
      );

      for (const paragraph of postContent) {
        for (const element of paragraph) {
          if (element.tag === 'text') {
            text += element.text || '';
          } else if (element.tag === 'at') {
            text += `@${element.user_name || '某人'} `;
          } else if (element.tag === 'img' || element.tag === 'image') {
            // Download image
            const imageKey = element.image_key;
            logger.debug(
              { messageId: message.message_id, imageKey },
              'Found image in post',
            );
            if (imageKey) {
              const imageResult = await this.downloadImage(
                message.message_id,
                JSON.stringify({ image_key: imageKey }),
              );
              if (imageResult) {
                images.push(imageResult);
                logger.debug(
                  {
                    messageId: message.message_id,
                    size: imageResult.base64.length,
                  },
                  'Image downloaded for post',
                );
              }
            }
          }
        }
        text += '\n';
      }

      const chatJid = toJid(message.chat_id);
      const ts = new Date(Number(message.create_time)).toISOString();
      this.opts.onChatMetadata(chatJid, ts, undefined, 'feishu', isGroup);

      // Build content with images embedded
      const content = text.trim();
      logger.debug(
        {
          messageId: message.message_id,
          textLength: text.length,
          imageCount: images.length,
        },
        'Post message processed',
      );

      if (content || images.length > 0) {
        // Check if any image has OCR error - if so, return error only, no image
        const errorImage = images.find(
          (img) => !img.ocrText || img.ocrText.startsWith('['),
        );
        if (errorImage) {
          const msg: NewMessage = {
            id: message.message_id,
            chat_jid: chatJid,
            sender: openId,
            sender_name: openId,
            content: errorImage.ocrText || '[OCR服务失败，请稍后再试]',
            timestamp: ts,
            is_from_me: false,
            is_bot_message: sender.sender_type === 'app',
          };
          this.opts.onMessage(chatJid, msg);
          return;
        }

        let fullContent = content;
        // Add OCR text for each image only (no image attachments)
        for (const img of images) {
          if (img.ocrText) {
            fullContent += `\n[图片文字识别结果: ${img.ocrText}]`;
          }
        }
        const msg: NewMessage = {
          id: message.message_id,
          chat_jid: chatJid,
          sender: openId,
          sender_name: openId,
          content: fullContent,
          timestamp: ts,
          is_from_me: false,
          is_bot_message: sender.sender_type === 'app',
        };
        this.opts.onMessage(chatJid, msg);
      } else {
        logger.warn(
          { messageId: message.message_id },
          'Post message had no text or images',
        );
      }
      return;
    }

    // Only handle text messages
    if (message.message_type !== 'text') {
      logger.debug(
        { type: message.message_type },
        'Feishu: skipping non-text message',
      );
      return;
    }

    let text: string;
    try {
      const parsed = JSON.parse(message.content);
      text = parsed.text || '';
    } catch {
      text = message.content;
    }
    if (!text) return;

    // Replace @mention tags with readable names.
    // When the bot itself is @mentioned, replace with @ASSISTANT_NAME
    // so the trigger pattern matches.
    if (message.mentions) {
      for (const mention of message.mentions) {
        const isBotMention =
          this.botOpenId && mention.id?.open_id === this.botOpenId;
        const replacement = isBotMention
          ? `@${ASSISTANT_NAME}`
          : `@${mention.name}`;
        text = text.replace(mention.key, replacement);
      }
    }

    const chatJid = toJid(message.chat_id);

    // Emit chat metadata
    const ts = new Date(Number(message.create_time)).toISOString();
    this.opts.onChatMetadata(chatJid, ts, undefined, 'feishu', isGroup);

    const msg: NewMessage = {
      id: message.message_id,
      chat_jid: chatJid,
      sender: openId,
      sender_name: openId,
      content: text,
      timestamp: ts,
      is_from_me: false,
      is_bot_message: sender.sender_type === 'app',
    };

    this.opts.onMessage(chatJid, msg);
  }

  private async addReaction(messageId: string): Promise<void> {
    await this.client.im.messageReaction.create({
      data: {
        reaction_type: {
          emoji_type: 'Get',
        },
      },
      path: {
        message_id: messageId,
      },
    });
  }

  private async downloadImage(
    messageId: string,
    content: string,
  ): Promise<{ base64: string; mimeType: string; ocrText?: string } | null> {
    let imageKey: string;
    try {
      const parsed = JSON.parse(content);
      imageKey = parsed.image_key;
    } catch {
      logger.warn({ content }, 'Failed to parse image message content');
      return null;
    }

    if (!imageKey) {
      logger.warn({ content }, 'No image_key in image message');
      return null;
    }

    try {
      const response = await this.client.im.messageResource.get({
        path: {
          message_id: messageId,
          file_key: imageKey,
        },
        params: {
          type: 'image',
        },
      });

      // Get content-type from headers
      const contentType = response.headers?.['content-type'] || 'image/png';

      // Get readable stream and collect all chunks
      const stream = response.getReadableStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);
      const base64 = buffer.toString('base64');
      logger.debug(
        { messageId, imageKey, size: buffer.length, contentType },
        'Feishu image downloaded',
      );

      // Queue OCR request to avoid rate limiting (20 QPS limit)
      const ocrText = await this.queueOcr(messageId, base64);

      return { base64, mimeType: contentType, ocrText };
    } catch (err) {
      logger.error(
        { err, messageId, imageKey },
        'Failed to download Feishu image',
      );
      return null;
    }
  }

  private async downloadFile(
    messageId: string,
    content: string,
  ): Promise<{ base64: string; mimeType: string; filename: string } | null> {
    let fileKey: string;
    let filename = 'file';
    try {
      const parsed = JSON.parse(content);
      fileKey = parsed.file_key;
      if (parsed.file_name) {
        // Try to decode URL-encoded filename (飞书有时会 URL 编码中文)
        let rawFilename = parsed.file_name;
        try {
          rawFilename = decodeURIComponent(rawFilename);
        } catch {
          // ignore
        }
        // Fix encoding when UTF-8 Chinese was misinterpreted as Latin-1
        filename = fixFilenameEncoding(rawFilename);
      }
    } catch {
      logger.warn({ content }, 'Failed to parse file message content');
      return null;
    }

    if (!fileKey) {
      logger.warn({ content }, 'No file_key in file message');
      return null;
    }

    try {
      const response = await this.client.im.messageResource.get({
        path: {
          message_id: messageId,
          file_key: fileKey,
        },
        params: {
          type: 'file',
        },
      });

      // Get content-type from headers
      const contentType =
        response.headers?.['content-type'] || 'application/octet-stream';

      // Try to get filename from content-disposition header
      // Handle RFC 5987 encoding: filename*="UTF-8''%E6%96%87%E4%BB%B6.txt"
      const contentDisposition = response.headers?.['content-disposition'];
      if (contentDisposition) {
        const match = contentDisposition.match(
          /filename\*=(?:UTF-8''|utf-8'')([^;\n]+)/i,
        );
        if (match) {
          try {
            filename = decodeURIComponent(match[1]);
          } catch {
            filename = match[1];
          }
        } else {
          const simpleMatch = contentDisposition.match(
            /filename="?([^";\n]+)"?/,
          );
          if (simpleMatch) {
            filename = fixFilenameEncoding(simpleMatch[1]);
          }
        }
      }

      // Get readable stream and collect all chunks
      const stream = response.getReadableStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);
      const base64 = buffer.toString('base64');
      logger.debug(
        { messageId, fileKey, size: buffer.length, contentType, filename },
        'Feishu file downloaded',
      );

      return { base64, mimeType: contentType, filename };
    } catch (err) {
      logger.error(
        { err, messageId, fileKey },
        'Failed to download Feishu file',
      );
      return null;
    }
  }

  // Process OCR queue with rate limiting (20 QPS = 50ms between requests)
  private async processOcrQueue(): Promise<void> {
    if (this.ocrProcessing || this.ocrQueue.length === 0) return;
    this.ocrProcessing = true;

    while (this.ocrQueue.length > 0) {
      const now = Date.now();
      const elapsed = now - this.lastOcrTime;
      if (elapsed < 500) {
        await new Promise((resolve) => setTimeout(resolve, 500 - elapsed));
      }

      const item = this.ocrQueue.shift()!;
      this.lastOcrTime = Date.now();

      try {
        const ocrResult = await this.client.request({
          method: 'POST',
          url: 'https://open.feishu.cn/open-apis/optical_char_recognition/v1/image/basic_recognize',
          data: { image: item.base64 },
        });
        if (ocrResult?.data?.text_list && ocrResult.data.text_list.length > 0) {
          const ocrText = ocrResult.data.text_list.join('\n');
          logger.debug(
            { messageId: item.messageId, ocrTextLength: ocrText.length },
            'Feishu OCR succeeded',
          );
          item.resolve(ocrText);
        } else {
          item.resolve(undefined);
        }
      } catch (ocrErr: any) {
        const isRateLimit = ocrErr?.response?.data?.code === 99991400;
        logger.warn(
          {
            err: ocrErr,
            messageId: item.messageId,
            responseData: ocrErr?.response?.data,
          },
          'Feishu OCR failed',
        );
        if (isRateLimit) {
          item.resolve('[OCR服务限流中，请稍后再试]');
        } else {
          item.resolve('[OCR服务失败，请稍后再试]');
        }
      }
    }

    this.ocrProcessing = false;
  }

  private queueOcr(
    messageId: string,
    base64: string,
  ): Promise<string | undefined> {
    return new Promise((resolve) => {
      this.ocrQueue.push({ messageId, base64, resolve });
      this.processOcrQueue();
    });
  }
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Try to split at last newline within limit
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt <= 0) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, '');
  }
  return chunks;
}

// Self-register: factory returns null when credentials are missing
registerChannel('feishu', (opts: ChannelOpts) => {
  const env = readEnvFile(['FEISHU_APP_ID', 'FEISHU_APP_SECRET']);
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) return null;
  return new FeishuChannel(env.FEISHU_APP_ID, env.FEISHU_APP_SECRET, opts);
});
