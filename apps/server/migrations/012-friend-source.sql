-- 第二轮 S3：记好友是怎么加上的，好友卡上显示「搜索添加 / 最近同桌」；老好友为空，按首次同桌房间显示「同桌对局」。只加不删。
ALTER TABLE friend_requests ADD COLUMN source text NOT NULL DEFAULT 'search' CHECK (source IN ('search', 'recent'));
ALTER TABLE friends ADD COLUMN source text CHECK (source IN ('search', 'recent'));
