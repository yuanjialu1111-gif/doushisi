import { openDatabase, migrate } from './database.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for production migrations.');
const db = await openDatabase(process.env.DATABASE_URL);
try {
  await migrate(db);
  await db.exec(`
    REVOKE ALL ON SCHEMA public FROM PUBLIC;
    GRANT USAGE ON SCHEMA public TO dss_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON accounts, sessions, wallets, rooms, room_members,
      rounds, deal_policies, friends, dissolve_votes, original_protocol_ids, original_protocol_regions,
      friend_requests, friend_messages, room_invites, account_medals, app_settings TO dss_app;
    GRANT SELECT, INSERT ON ledger_operations, ledger_entries, audit_events, game_events, round_score_events TO dss_app;
    GRANT SELECT ON schema_migrations, room_member_settlement_totals TO dss_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO dss_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON ledger_operations, ledger_entries, audit_events, game_events, round_score_events FROM dss_app;
  `);
  console.log('Database migrations and restricted runtime grants applied.');
} finally { await db.close(); }
