CREATE TABLE "alerts_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "injuries" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" text NOT NULL,
	"season" smallint NOT NULL,
	"week" smallint NOT NULL,
	"report_status" text,
	"practice_status" text,
	"as_of" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league" (
	"league_id" text PRIMARY KEY NOT NULL,
	"season" smallint NOT NULL,
	"settings" jsonb NOT NULL,
	"scoring_settings" jsonb NOT NULL,
	"roster_positions" jsonb NOT NULL,
	"playoff_teams" smallint NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matchups" (
	"season" smallint NOT NULL,
	"week" smallint NOT NULL,
	"roster_id" integer NOT NULL,
	"matchup_id" integer,
	"points" real,
	"starters" text[] NOT NULL,
	"players" text[] NOT NULL,
	"players_points" jsonb,
	CONSTRAINT "matchups_season_week_roster_id_pk" PRIMARY KEY("season","week","roster_id")
);
--> statement-breakpoint
CREATE TABLE "owners" (
	"roster_id" integer PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"team_name" text
);
--> statement-breakpoint
CREATE TABLE "players" (
	"sleeper_id" text PRIMARY KEY NOT NULL,
	"full_name" text,
	"position" text,
	"team" text,
	"age" smallint,
	"years_exp" smallint,
	"status" text,
	"injury_status" text,
	"practice_participation" text,
	"depth_chart_order" smallint,
	"news_updated" timestamp with time zone,
	"gsis_id" text,
	"espn_id" text,
	"sportradar_id" text,
	"yahoo_id" text,
	"rotowire_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projections" (
	"player_id" text NOT NULL,
	"season" smallint NOT NULL,
	"week" smallint NOT NULL,
	"source" text NOT NULL,
	"stats" jsonb NOT NULL,
	"league_pts" real NOT NULL,
	"as_of" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projections_player_id_season_week_source_pk" PRIMARY KEY("player_id","season","week","source")
);
--> statement-breakpoint
CREATE TABLE "raw_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"endpoint" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"body" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roster_players" (
	"roster_id" integer NOT NULL,
	"player_id" text NOT NULL,
	"acquired_via" text,
	"acquired_at" timestamp with time zone,
	CONSTRAINT "roster_players_roster_id_player_id_pk" PRIMARY KEY("roster_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "roster_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"roster_id" integer NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"taken_date" text NOT NULL,
	"players" text[] NOT NULL,
	"starters" text[] NOT NULL,
	"reserve" text[],
	"taxi" text[],
	"faab_used" integer,
	"wins" smallint,
	"losses" smallint,
	"fpts" real
);
--> statement-breakpoint
CREATE TABLE "schedule" (
	"season" smallint NOT NULL,
	"week" smallint NOT NULL,
	"team" text NOT NULL,
	"opponent" text,
	"kickoff_utc" timestamp with time zone,
	"is_home" boolean,
	"is_bye" boolean DEFAULT false NOT NULL,
	CONSTRAINT "schedule_season_week_team_pk" PRIMARY KEY("season","week","team")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"transaction_id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"season" smallint NOT NULL,
	"week" smallint,
	"status" text NOT NULL,
	"roster_ids" integer[] NOT NULL,
	"adds" jsonb,
	"drops" jsonb,
	"draft_picks" jsonb,
	"waiver_bid" integer,
	"waiver_budget" jsonb,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "injuries_player_week_asof_idx" ON "injuries" USING btree ("player_id","season","week","as_of");--> statement-breakpoint
CREATE UNIQUE INDEX "roster_snapshots_roster_date_idx" ON "roster_snapshots" USING btree ("roster_id","taken_date");