-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "username" TEXT NOT NULL,
    "password_hash" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "password_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "token_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "password_version" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("token_hash")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- Existing personal data already uses this owner. No data IDs need rewriting.
INSERT INTO users (id, username, role) VALUES ('me', 'admin', 'admin');
ALTER TABLE users ADD CONSTRAINT users_username_format CHECK (username ~ '^[a-z0-9_-]{3,32}$');
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
  (id = 'me' AND username = 'admin' AND role = 'admin') OR
  (id <> 'me' AND username <> 'admin' AND role = 'user' AND password_hash IS NOT NULL)
);

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
