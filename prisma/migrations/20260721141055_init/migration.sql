-- CreateEnum
CREATE TYPE "EnvironmentName" AS ENUM ('development', 'staging', 'production');

-- CreateEnum
CREATE TYPE "FlagType" AS ENUM ('boolean', 'string', 'number');

-- CreateEnum
CREATE TYPE "FlagStatus" AS ENUM ('active', 'archived');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "environments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" "EnvironmentName" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "environments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key_hash" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "flag_key" TEXT NOT NULL,
    "description" TEXT,
    "type" "FlagType" NOT NULL,
    "default_value" JSONB NOT NULL,
    "status" "FlagStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flag_environment_configs" (
    "id" UUID NOT NULL,
    "flag_id" UUID NOT NULL,
    "environment_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rollout_percentage" INTEGER NOT NULL DEFAULT 0,
    "targeting_rules" JSONB,
    "variant_value" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flag_environment_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "flag_id" UUID NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before_value" JSONB,
    "after_value" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "environments_tenant_id_idx" ON "environments"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "environments_tenant_id_name_key" ON "environments"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "api_keys_tenant_id_active_idx" ON "api_keys"("tenant_id", "active");

-- CreateIndex
CREATE INDEX "feature_flags_tenant_id_status_idx" ON "feature_flags"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_tenant_id_flag_key_key" ON "feature_flags"("tenant_id", "flag_key");

-- CreateIndex
CREATE INDEX "flag_environment_configs_environment_id_idx" ON "flag_environment_configs"("environment_id");

-- CreateIndex
CREATE UNIQUE INDEX "flag_environment_configs_flag_id_environment_id_key" ON "flag_environment_configs"("flag_id", "environment_id");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_flag_id_created_at_idx" ON "audit_logs"("tenant_id", "flag_id", "created_at");

-- AddForeignKey
ALTER TABLE "environments" ADD CONSTRAINT "environments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flag_environment_configs" ADD CONSTRAINT "flag_environment_configs_flag_id_fkey" FOREIGN KEY ("flag_id") REFERENCES "feature_flags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flag_environment_configs" ADD CONSTRAINT "flag_environment_configs_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_flag_id_fkey" FOREIGN KEY ("flag_id") REFERENCES "feature_flags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
