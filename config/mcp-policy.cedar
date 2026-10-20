// BleedStop MCP gateway policy (Cedar). Default deny: a tool call needs a matching permit.
// Resource ids are "<server>/<tool>". Context: server, tool, argText, urlHosts, recipientDomains,
// externalRecipient, amountCents. @effect("challenge") on a forbid means "needs human approval".

@id("demo-tenant-may-call-demo-servers")
permit (principal == Tenant::"demo", action == Action::"call_tool", resource)
when { context.server like "demo-*" };

@id("local-dev-may-call-anything")
permit (principal == Tenant::"local-dev", action == Action::"call_tool", resource);

@id("no-shell-for-anyone")
forbid (principal, action == Action::"call_tool", resource)
when { context.tool like "*shell*" || context.tool like "*exec*" };

@id("external-email-needs-approval")
@effect("challenge")
forbid (principal, action == Action::"call_tool", resource)
when { context.tool like "send_*mail*" && context.externalRecipient };

@id("payments-over-50-usd-need-approval")
@effect("challenge")
forbid (principal, action == Action::"call_tool", resource)
when { context.tool like "*payment*" && context.amountCents > 5000 };

@id("no-paste-sites")
forbid (principal, action == Action::"call_tool", resource)
when { context.urlHosts.contains("pastebin.com") || context.urlHosts.contains("webhook.site") || context.urlHosts.contains("requestbin.net") };
