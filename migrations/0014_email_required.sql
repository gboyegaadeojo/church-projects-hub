-- v4.7: email is required for everyone. Settings saved as "off" before are dropped, so those emails follow the
-- event's default (right away or the morning digest). The app also ignores any "off" it finds.
DELETE FROM `notification_prefs` WHERE `channel` = 'email' AND `mode` = 'off';
