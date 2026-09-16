CREATE TABLE `content_artifact_sources` (
	`artifact_id` text NOT NULL,
	`source_slot_id` text NOT NULL,
	`source_revision` integer,
	`last_accessed_at` text NOT NULL,
	PRIMARY KEY(`artifact_id`, `source_slot_id`),
	FOREIGN KEY (`artifact_id`) REFERENCES `project_context_artifacts`(`artifact_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `content_artifact_sources_by_slot` ON `content_artifact_sources` (`source_slot_id`,`last_accessed_at`);