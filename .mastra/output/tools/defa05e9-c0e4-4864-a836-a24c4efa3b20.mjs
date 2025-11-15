import { createTool } from '@mastra/core';
import { z } from 'zod';
import { octokit } from './754fb248-e631-410f-83ec-8259b376ecd8.mjs';
import { PinoLogger } from '@mastra/loggers';
import { AISpanType } from '@mastra/core/ai-tracing';
import '@octokit/rest';

const logger = new PinoLogger({ level: "info" });
const EventActorSchema = z.object({
  id: z.number(),
  login: z.string(),
  display_login: z.string().optional(),
  gravatar_id: z.string().optional(),
  url: z.string().url(),
  avatar_url: z.string().url()
});
const EventRepoSchema = z.object({
  id: z.number(),
  name: z.string(),
  url: z.string().url()
});
const EventSchema = z.object({
  id: z.string(),
  type: z.string(),
  actor: EventActorSchema,
  repo: EventRepoSchema,
  payload: z.record(z.any()),
  // More flexible than strict empty object
  public: z.boolean(),
  created_at: z.string().datetime()
});
z.object({
  id: z.string(),
  thread_id: z.number(),
  repository: z.object({
    id: z.number(),
    node_id: z.string(),
    name: z.string(),
    full_name: z.string(),
    private: z.boolean()
  }),
  reason: z.enum(["subscribed", "mention", "review_requested", "ci_activity", "review_request_removed", "review_dismissed", "review_re_request", "repo", "assigned", "comment", "team_mention", "security_and_maintenance"]),
  subject: z.object({
    title: z.string(),
    url: z.string().url(),
    type: z.enum(["Issue", "PullRequest", "Release", "RepositoryAdvisory", "RepositoryVulnerabilityAlert", "Discussion"]),
    latest_comment_url: z.string().url().optional()
  }),
  url: z.string().url(),
  updated_at: z.string().datetime(),
  last_read_at: z.string().datetime().optional(),
  unsubscribe_url: z.string().url(),
  subscription_url: z.string().url()
});
const SubscriptionSchema = z.object({
  subscribed: z.boolean(),
  ignored: z.boolean(),
  reason: z.string().nullable(),
  created_at: z.string().datetime().optional(),
  url: z.string().url().optional(),
  repository_url: z.string().url().optional()
}).partial({
  created_at: true,
  url: true,
  repository_url: true
});
const BaseOutputSchema = (dataSchema) => z.object({
  status: z.enum(["success", "error"]),
  data: dataSchema.optional(),
  errorMessage: z.string().optional(),
  metadata: z.object({
    request_id: z.string().optional(),
    rate_limit_remaining: z.number().optional(),
    rate_limit_reset: z.string().datetime().optional()
  }).optional()
}).strict();
const parseGitHubError = (error) => {
  if (error !== null && error !== void 0 && typeof error === "object" && "status" in error) {
    const ghError = error;
    return {
      status: ghError.status,
      message: ghError.message ?? "Unknown GitHub API error",
      documentation_url: ghError.documentation_url,
      request_id: ghError.request?.id,
      rate_limit_remaining: ghError.response?.headers?.["x-ratelimit-remaining"],
      rate_limit_reset: ghError.response?.headers?.["x-ratelimit-reset"]
    };
  }
  return {
    status: 500,
    message: error instanceof Error ? error.message : String(error),
    documentation_url: void 0,
    request_id: void 0,
    rate_limit_remaining: void 0,
    rate_limit_reset: void 0
  };
};
const listPublicEvents = createTool({
  id: "listPublicEvents",
  description: "Lists public events across GitHub with pagination support. Returns recent public activity from all users and repositories.",
  inputSchema: z.object({
    per_page: z.number().min(1).max(100).optional().default(30).describe("Number of events per page"),
    page: z.number().min(1).optional().default(1).describe("Page number for pagination")
  }),
  outputSchema: BaseOutputSchema(z.array(EventSchema)),
  execute: async ({ context, tracingContext }) => {
    const spanName = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "list_public_events",
      input: { per_page: context.per_page, page: context.page }
    });
    try {
      const events = await octokit.activity.listPublicEvents({
        per_page: context.per_page ?? 30,
        page: context.page ?? 1
      });
      logger.info("Public events listed successfully", {
        count: events.data?.length ?? 0
      });
      spanName?.end({
        output: { events_count: events.data?.length ?? 0 },
        metadata: { operation: "list_public_events" }
      });
      return BaseOutputSchema(z.array(EventSchema)).parse({
        status: "success",
        data: events.data,
        metadata: {
          request_id: events.headers?.["x-github-request-id"],
          rate_limit_remaining: parseInt(events.headers?.["x-ratelimit-remaining"] ?? "0"),
          rate_limit_reset: events.headers?.["x-ratelimit-reset"]
        }
      });
    } catch (error) {
      const githubError = parseGitHubError(error);
      logger.error("GitHub API error in listPublicEvents", {
        operation: "list_public_events",
        status: githubError.status,
        message: githubError.message
      });
      spanName?.end({
        metadata: {
          error: githubError.message,
          status: githubError.status,
          operation: "list_public_events"
        }
      });
      return BaseOutputSchema(z.array(EventSchema)).parse({
        status: "error",
        errorMessage: githubError.message,
        metadata: {
          request_id: githubError.request_id,
          rate_limit_remaining: githubError.rate_limit_remaining,
          rate_limit_reset: githubError.rate_limit_reset
        }
      });
    }
  }
});
const markRepoNotificationsAsRead = createTool({
  id: "markRepoNotificationsAsRead",
  description: "Marks all notifications as read for a repository. Useful for clearing notification backlog.",
  inputSchema: z.object({
    owner: z.string().describe("Repository owner (username or organization)"),
    repo: z.string().describe("Repository name"),
    last_read_at: z.string().datetime().optional().describe("Optional timestamp to mark notifications as read until")
  }),
  outputSchema: BaseOutputSchema(z.object({ success: z.boolean() })),
  execute: async ({ context, tracingContext }) => {
    const spanName = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "mark_repo_notifications_as_read",
      input: { owner: context.owner, repo: context.repo, last_read_at: context.last_read_at }
    });
    try {
      await octokit.activity.markRepoNotificationsAsRead({
        owner: context.owner,
        repo: context.repo,
        last_read_at: context.last_read_at
      });
      logger.info("Repository notifications marked as read successfully", {
        owner: context.owner,
        repo: context.repo
      });
      spanName?.end({
        output: { success: true },
        metadata: { operation: "mark_repo_notifications_as_read" }
      });
      return BaseOutputSchema(z.object({ success: z.boolean() })).parse({
        status: "success",
        data: { success: true }
      });
    } catch (error) {
      const githubError = parseGitHubError(error);
      logger.error("GitHub API error in markRepoNotificationsAsRead", {
        operation: "mark_repo_notifications_as_read",
        status: githubError.status,
        message: githubError.message,
        owner: context.owner,
        repo: context.repo
      });
      spanName?.end({
        metadata: {
          error: githubError.message,
          status: githubError.status,
          operation: "mark_repo_notifications_as_read"
        }
      });
      return BaseOutputSchema(z.object({ success: z.boolean() })).parse({
        status: "error",
        errorMessage: githubError.message,
        metadata: {
          request_id: githubError.request_id,
          rate_limit_remaining: githubError.rate_limit_remaining,
          rate_limit_reset: githubError.rate_limit_reset
        }
      });
    }
  }
});
const getRepoSubscription = createTool({
  id: "getRepoSubscription",
  description: "Gets the current subscription status for a repository. Shows whether notifications are enabled and subscription preferences.",
  inputSchema: z.object({
    owner: z.string().describe("Repository owner (username or organization)"),
    repo: z.string().describe("Repository name")
  }),
  outputSchema: BaseOutputSchema(SubscriptionSchema),
  execute: async ({ context, tracingContext }) => {
    const spanName = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "get_repo_subscription",
      input: { owner: context.owner, repo: context.repo }
    });
    try {
      const subscription = await octokit.activity.getRepoSubscription({
        owner: context.owner,
        repo: context.repo
      });
      logger.info("Repository subscription retrieved successfully", {
        owner: context.owner,
        repo: context.repo,
        subscribed: subscription.data.subscribed,
        ignored: subscription.data.ignored
      });
      spanName?.end({
        output: { subscribed: subscription.data.subscribed, ignored: subscription.data.ignored },
        metadata: { operation: "get_repo_subscription" }
      });
      return BaseOutputSchema(SubscriptionSchema).parse({
        status: "success",
        data: subscription.data,
        metadata: {
          request_id: subscription.headers?.["x-github-request-id"],
          rate_limit_remaining: parseInt(subscription.headers?.["x-ratelimit-remaining"] ?? "0"),
          rate_limit_reset: subscription.headers?.["x-ratelimit-reset"]
        }
      });
    } catch (error) {
      const githubError = parseGitHubError(error);
      logger.error("GitHub API error in getRepoSubscription", {
        operation: "get_repo_subscription",
        status: githubError.status,
        message: githubError.message,
        owner: context.owner,
        repo: context.repo
      });
      spanName?.end({
        metadata: {
          error: githubError.message,
          status: githubError.status,
          operation: "get_repo_subscription"
        }
      });
      return BaseOutputSchema(SubscriptionSchema).parse({
        status: "error",
        errorMessage: githubError.message,
        metadata: {
          request_id: githubError.request_id,
          rate_limit_remaining: githubError.rate_limit_remaining,
          rate_limit_reset: githubError.rate_limit_reset
        }
      });
    }
  }
});
const setRepoSubscription = createTool({
  id: "setRepoSubscription",
  description: "Sets notification subscription preferences for a repository. Control whether to receive notifications and subscription behavior.",
  inputSchema: z.object({
    owner: z.string().describe("Repository owner (username or organization)"),
    repo: z.string().describe("Repository name"),
    subscribed: z.boolean().optional().describe("Whether to subscribe to notifications"),
    ignored: z.boolean().optional().describe("Whether to ignore notifications (takes precedence over subscribed)")
  }),
  outputSchema: BaseOutputSchema(SubscriptionSchema),
  execute: async ({ context, tracingContext }) => {
    const spanName = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "set_repo_subscription",
      input: {
        owner: context.owner,
        repo: context.repo,
        subscribed: context.subscribed,
        ignored: context.ignored
      }
    });
    try {
      const subscription = await octokit.rest.activity.setRepoSubscription({
        owner: context.owner,
        repo: context.repo,
        subscribed: context.subscribed,
        ignored: context.ignored
      });
      logger.info("Repository subscription set successfully", {
        owner: context.owner,
        repo: context.repo,
        subscribed: subscription.data.subscribed,
        ignored: subscription.data.ignored
      });
      spanName?.end({
        output: { subscribed: subscription.data.subscribed, ignored: subscription.data.ignored },
        metadata: { operation: "set_repo_subscription" }
      });
      return BaseOutputSchema(SubscriptionSchema).parse({
        status: "success",
        data: subscription.data,
        metadata: {
          request_id: subscription.headers?.["x-github-request-id"],
          rate_limit_remaining: parseInt(subscription.headers?.["x-ratelimit-remaining"] ?? "0"),
          rate_limit_reset: subscription.headers?.["x-ratelimit-reset"]
        }
      });
    } catch (error) {
      const githubError = parseGitHubError(error);
      logger.error("GitHub API error in setRepoSubscription", {
        operation: "set_repo_subscription",
        status: githubError.status,
        message: githubError.message,
        owner: context.owner,
        repo: context.repo
      });
      spanName?.end({
        metadata: {
          error: githubError.message,
          status: githubError.status,
          operation: "set_repo_subscription"
        }
      });
      return BaseOutputSchema(SubscriptionSchema).parse({
        status: "error",
        errorMessage: githubError.message,
        metadata: {
          request_id: githubError.request_id,
          rate_limit_remaining: githubError.rate_limit_remaining,
          rate_limit_reset: githubError.rate_limit_reset
        }
      });
    }
  }
});
const deleteRepoSubscription = createTool({
  id: "deleteRepoSubscription",
  description: "Deletes the notification subscription for a repository. Stops receiving notifications for this repository.",
  inputSchema: z.object({
    owner: z.string().describe("Repository owner (username or organization)"),
    repo: z.string().describe("Repository name")
  }),
  outputSchema: BaseOutputSchema(z.object({ success: z.boolean() })),
  execute: async ({ context, tracingContext }) => {
    const spanName = tracingContext?.currentSpan?.createChildSpan({
      type: AISpanType.GENERIC,
      name: "delete_repo_subscription",
      input: { owner: context.owner, repo: context.repo }
    });
    try {
      await octokit.rest.activity.deleteRepoSubscription({
        owner: context.owner,
        repo: context.repo
      });
      logger.info("Repository subscription deleted successfully", {
        owner: context.owner,
        repo: context.repo
      });
      spanName?.end({
        output: { success: true },
        metadata: { operation: "delete_repo_subscription" }
      });
      return BaseOutputSchema(z.object({ success: z.boolean() })).parse({
        status: "success",
        data: { success: true }
      });
    } catch (error) {
      const githubError = parseGitHubError(error);
      logger.error("GitHub API error in deleteRepoSubscription", {
        operation: "delete_repo_subscription",
        status: githubError.status,
        message: githubError.message,
        owner: context.owner,
        repo: context.repo
      });
      spanName?.end({
        metadata: {
          error: githubError.message,
          status: githubError.status,
          operation: "delete_repo_subscription"
        }
      });
      return BaseOutputSchema(z.object({ success: z.boolean() })).parse({
        status: "error",
        errorMessage: githubError.message,
        metadata: {
          request_id: githubError.request_id,
          rate_limit_remaining: githubError.rate_limit_remaining,
          rate_limit_reset: githubError.rate_limit_reset
        }
      });
    }
  }
});

export { deleteRepoSubscription, getRepoSubscription, listPublicEvents, markRepoNotificationsAsRead, setRepoSubscription };
