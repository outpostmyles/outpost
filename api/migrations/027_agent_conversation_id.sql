-- FIX (2026-06-18): the agent could not save ANY message in production. Root cause
-- was schema drift: agent_messages.conversation_id powers the multiple-conversations
-- feature (new / switch / delete chats), but it was added to the DEV database directly
-- during that feature and never written into schema.sql or a migration. So the prod
-- database, built from the setup bundle (schema.sql + migrations), was created WITHOUT
-- it. Every agent message insert (api/functions/agent.js, both /messages and /stream)
-- writes conversation_id, so on prod the first message failed with
-- "Failed to save message, credits refunded" and the agent never replied.
--
-- TEXT, not uuid: the column holds conversation UUIDs-as-strings AND sentinels like
-- 'opener_<date>'. Nullable: a null conversation_id is the user's default / legacy chat.
alter table agent_messages add column if not exists conversation_id text;

-- The agent filters messages by (user_id, conversation_id) on every turn and groups by
-- conversation_id to list chats; index it so history stays fast as it grows.
create index if not exists agent_messages_user_conv_idx on agent_messages (user_id, conversation_id);
