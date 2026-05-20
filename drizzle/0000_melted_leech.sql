CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"collection" text NOT NULL,
	"schema_version" integer NOT NULL,
	"data" jsonb NOT NULL,
	"remote_source" text,
	"remote_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_tenant_collection_idx" ON "documents" USING btree ("tenant_id","collection");--> statement-breakpoint
CREATE INDEX "documents_tenant_collection_deleted_idx" ON "documents" USING btree ("tenant_id","collection","deleted_at");--> statement-breakpoint
CREATE INDEX "documents_data_gin_idx" ON "documents" USING gin ("data");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_remote_identity_unique" ON "documents" USING btree ("tenant_id","collection","remote_source","remote_id") WHERE "documents"."remote_source" is not null and "documents"."remote_id" is not null;