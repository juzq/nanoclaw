import { Channel, NewMessage } from './types.js';
import { formatLocalTime } from './timezone.js';

export function escapeXml(s: string): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatMessages(
  messages: NewMessage[],
  timezone: string,
): string {
  const lines = messages.map((m) => {
    const displayTime = formatLocalTime(m.timestamp, timezone);
    // Extract attachment tags before escaping (they contain raw base64, not user text)
    const attachmentRegex = /<attachment[^>]*>[\s\S]*?<\/attachment>/g;
    const attachments = m.content.match(attachmentRegex) || [];
    const textContent = m.content.replace(attachmentRegex, '').trim();
    const escapedContent = escapeXml(textContent);
    const escapedAttachments = attachments.map((att) => {
      // Extract the base64 data and mimeType, then reconstruct without escaping base64
      const mimeMatch = att.match(/mimeType="([^"]+)"/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
      const dataMatch = att.match(/>([^<]+)<\/attachment>/);
      const data = dataMatch ? dataMatch[1] : '';
      return `<attachment type="image" mimeType="${mimeType}">${data}</attachment>`;
    });
    const finalContent =
      escapedContent +
      (escapedAttachments.length > 0
        ? '\n' + escapedAttachments.join('\n')
        : '');
    return `<message sender="${escapeXml(m.sender_name)}" time="${escapeXml(displayTime)}">${finalContent}</message>`;
  });

  const header = `<context timezone="${escapeXml(timezone)}" />\n`;

  return `${header}<messages>\n${lines.join('\n')}\n</messages>`;
}

export function stripInternalTags(text: string): string {
  return text.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
}

export function formatOutbound(rawText: string): string {
  const text = stripInternalTags(rawText);
  if (!text) return '';
  return text;
}

export function routeOutbound(
  channels: Channel[],
  jid: string,
  text: string,
): Promise<void> {
  const channel = channels.find((c) => c.ownsJid(jid) && c.isConnected());
  if (!channel) throw new Error(`No channel for JID: ${jid}`);
  return channel.sendMessage(jid, text);
}

export function findChannel(
  channels: Channel[],
  jid: string,
): Channel | undefined {
  return channels.find((c) => c.ownsJid(jid));
}
