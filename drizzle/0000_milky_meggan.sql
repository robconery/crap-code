CREATE TABLE `authorizations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`date` text NOT NULL,
	`sku` text NOT NULL,
	`email` text NOT NULL,
	`number` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `fulfillment_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`date` text NOT NULL,
	`sku` text NOT NULL,
	`email` text NOT NULL,
	`number` text NOT NULL,
	`downloads` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`stripe_checkout_id` text NOT NULL,
	`number` text NOT NULL,
	`user_id` integer NOT NULL,
	`store` text NOT NULL,
	`slug` text NOT NULL,
	`email` text NOT NULL,
	`file` text,
	`resource_type` text,
	`amount_total` integer NOT NULL,
	`currency` text NOT NULL,
	`offer` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_stripe_checkout_id_unique` ON `orders` (`stripe_checkout_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_number_unique` ON `orders` (`number`);--> statement-breakpoint
CREATE TABLE `pings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`stripe_event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`raw_payload` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pings_stripe_event_id_unique` ON `pings` (`stripe_event_id`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`stripe_subscription_id` text NOT NULL,
	`user_id` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_stripe_subscription_id_unique` ON `subscriptions` (`stripe_subscription_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`stripe_customer_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);