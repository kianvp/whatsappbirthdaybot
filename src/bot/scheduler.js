import cron from 'node-cron';

const DEFAULT_MESSAGE = `🎂 Happy Birthday {name}! 🎉 Wishing you an incredible day filled with joy and celebration! From all of us in this group, have an amazing birthday! 🥳`;

export function startScheduler(db, botManager) {
  cron.schedule('0 8 * * *', () => sendBirthdayMessages(db, botManager));
  console.log('Birthday scheduler started — runs daily at 8:00 AM');
}

export async function sendBirthdayMessages(db, botManager) {
  const now = new Date();
  const day = now.getDate();
  const month = now.getMonth() + 1;

  console.log(`[Scheduler] Checking birthdays for ${day}/${month}...`);

  const birthdays = await db.prepare(`
    SELECT
      b.id AS birthday_id,
      b.person_name,
      b.birth_year,
      g.id AS group_id,
      g.group_jid,
      g.group_name,
      g.custom_message,
      u.id AS user_id,
      u.is_active,
      u.plan,
      u.subscription_status
    FROM birthdays b
    JOIN groups g ON g.id = b.group_id
    JOIN users u ON u.id = g.user_id
    WHERE b.birth_day = ? AND b.birth_month = ?
      AND g.is_active = 1
      AND u.is_active = 1
  `).all(day, month);

  console.log(`[Scheduler] Found ${birthdays.length} birthday(s) today`);

  for (const birthday of birthdays) {
    const allowed = birthday.plan === 'free' || birthday.subscription_status === 'active';
    if (!allowed) continue;

    const template = birthday.custom_message || DEFAULT_MESSAGE;
    const age = birthday.birth_year ? ` (turning ${now.getFullYear() - birthday.birth_year})` : '';
    const message = template.replace('{name}', `${birthday.person_name}${age}`);

    let success = 1;
    let error = null;

    try {
      await botManager.sendMessage(birthday.user_id, birthday.group_jid, message);
      console.log(`[Scheduler] Sent birthday message for ${birthday.person_name} in ${birthday.group_name}`);
    } catch (err) {
      success = 0;
      error = err.message;
      console.error(`[Scheduler] Failed for ${birthday.person_name}:`, err.message);
    }

    await db.prepare(`
      INSERT INTO birthday_logs (birthday_id, group_id, user_id, message, success, error)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(birthday.birthday_id, birthday.group_id, birthday.user_id, message, success, error);
  }
}
