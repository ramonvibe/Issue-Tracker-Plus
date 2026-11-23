CREATE TABLE "github_deliveries" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"event" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
