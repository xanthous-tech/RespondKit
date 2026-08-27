import { Link } from "@tanstack/react-router";
import {
  ArrowRightIcon,
  BotIcon,
  CheckIcon,
  LanguagesIcon,
  MessageCircleMoreIcon,
  MessagesSquareIcon,
  type LucideIcon,
} from "lucide-react";

import { Brand } from "@/components/brand";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const githubUrl = "https://github.com/xanthous-tech/RespondKit";

const features: ReadonlyArray<{
  readonly description: string;
  readonly icon: LucideIcon;
  readonly title: string;
}> = [
  {
    icon: MessageCircleMoreIcon,
    title: "React widget",
    description:
      "Ship an accessible support chat with one React component and your product context.",
  },
  {
    icon: LanguagesIcon,
    title: "Built-in translation",
    description: "Read customer messages in English and send replies back in their language.",
  },
  {
    icon: MessagesSquareIcon,
    title: "Discord inbox",
    description: "Run every conversation as a Discord thread with simple operator commands.",
  },
  {
    icon: BotIcon,
    title: "Agent-ready API",
    description: "Give an external agent thread context and a clear API surface for replies.",
  },
];

const installCode = `pnpm add @respondkit/react

import { RespondKitWidget } from "@respondkit/react";
import "@respondkit/react/styles.css";

export function Support() {
  return (
    <RespondKitWidget
      apiBaseUrl="https://api.respondkit.dev"
      context={{
        inboxId: "inbox_example",
        userId: "user_123",
        email: "customer@example.com",
      }}
    />
  );
}`;

function SiteHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
        <Link to="/" aria-label="RespondKit home">
          <Brand />
        </Link>
        <nav className="flex items-center gap-1" aria-label="Main navigation">
          <Link
            to="/docs/$"
            params={{ _splat: "" }}
            className={buttonVariants({ variant: "ghost" })}
          >
            Documentation
          </Link>
          <a className={cn(buttonVariants({ variant: "ghost" }), "max-sm:hidden")} href={githubUrl}>
            GitHub
          </a>
          <Link to="/docs/$" params={{ _splat: "getting-started" }} className={buttonVariants()}>
            Get started
          </Link>
        </nav>
      </div>
    </header>
  );
}

function CodePreview({ compact = false }: { readonly compact?: boolean }) {
  return (
    <Card className="min-w-0">
      <CardHeader className="border-b">
        <CardTitle>{compact ? "Add the widget" : "Quick start"}</CardTitle>
        <CardDescription>
          {compact ? "A single component, with context from your app." : "React + RespondKit"}
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <pre className="min-w-[32rem] font-mono text-xs leading-6 text-foreground">
          <code>{installCode}</code>
        </pre>
      </CardContent>
    </Card>
  );
}

function Hero() {
  return (
    <section className="border-b">
      <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 py-20 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:py-28">
        <div className="flex max-w-2xl flex-col items-start gap-7">
          <h1 className="text-5xl leading-[0.98] font-semibold tracking-[-0.05em] text-balance sm:text-6xl lg:text-7xl">
            Customer support that fits your stack.
          </h1>
          <p className="max-w-xl text-lg leading-8 text-muted-foreground">
            An open-core support toolkit with a React chat widget, built-in translation, Discord
            operations, and agent-ready APIs.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link to="/docs/$" params={{ _splat: "" }} className={buttonVariants({ size: "lg" })}>
              Read the docs
              <ArrowRightIcon data-icon="inline-end" />
            </Link>
            <a className={buttonVariants({ size: "lg", variant: "outline" })} href={githubUrl}>
              View on GitHub
            </a>
          </div>
        </div>
        <CodePreview />
      </div>
    </section>
  );
}

function FeatureBand() {
  return (
    <section className="border-b">
      <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-24">
        <div className="mb-14 text-center">
          <h2 className="text-3xl font-semibold tracking-tight">Built for product teams</h2>
          <p className="mt-3 text-muted-foreground">
            Everything you need to support customers, close to your stack.
          </p>
        </div>
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-4 lg:gap-0">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <div key={feature.title} className="flex min-w-0">
                {index > 0 ? (
                  <Separator orientation="vertical" className="mr-7 hidden lg:block" />
                ) : null}
                <div className="flex flex-col items-start gap-4 lg:px-3">
                  <Icon aria-hidden="true" className="size-7" strokeWidth={1.6} />
                  <h3 className="text-base font-semibold">{feature.title}</h3>
                  <p className="text-sm leading-6 text-muted-foreground">{feature.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function IntegrationSection() {
  return (
    <section className="border-b">
      <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 py-20 sm:px-8 lg:grid-cols-[0.75fr_1.25fr] lg:py-24">
        <div className="flex flex-col items-start gap-6">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight">Integrates in minutes</h2>
            <p className="mt-4 max-w-md leading-7 text-muted-foreground">
              Add the widget to your app, pass the customer context you already have, and connect
              the inbox to Discord.
            </p>
          </div>
          <ul className="flex flex-col gap-3 text-sm">
            {[
              "Install the React package",
              "Pass your inbox and customer context",
              "Start the conversation",
            ].map((step) => (
              <li key={step} className="flex items-center gap-3">
                <span className="flex size-5 items-center justify-center rounded-full border">
                  <CheckIcon aria-hidden="true" className="size-3" />
                </span>
                {step}
              </li>
            ))}
          </ul>
          <Link
            to="/docs/$"
            params={{ _splat: "react-widget" }}
            className={buttonVariants({ variant: "outline" })}
          >
            Read the integration guide
            <ArrowRightIcon data-icon="inline-end" />
          </Link>
        </div>
        <CodePreview compact />
      </div>
    </section>
  );
}

function FinalCallToAction() {
  return (
    <section className="mx-auto max-w-7xl px-5 py-16 sm:px-8">
      <Card>
        <CardHeader className="gap-3 sm:grid sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="flex flex-col gap-2">
            <CardTitle>Start with the React widget</CardTitle>
            <CardDescription>Launch support in your product today.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to="/docs/$" params={{ _splat: "getting-started" }} className={buttonVariants()}>
              Read the docs
              <ArrowRightIcon data-icon="inline-end" />
            </Link>
            <a className={buttonVariants({ variant: "outline" })} href={githubUrl}>
              View on GitHub
            </a>
          </div>
        </CardHeader>
      </Card>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="flex flex-col gap-3">
          <Brand />
          <p>Open-core customer support toolkit.</p>
        </div>
        <div className="flex gap-6">
          <Link to="/docs/$" params={{ _splat: "" }}>
            Documentation
          </Link>
          <a href={githubUrl}>GitHub</a>
          <a href="https://github.com/xanthous-tech/RespondKit/blob/main/LICENSE">MIT License</a>
        </div>
      </div>
    </footer>
  );
}

export function LandingPage() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <SiteHeader />
      <main>
        <Hero />
        <FeatureBand />
        <IntegrationSection />
        <FinalCallToAction />
      </main>
      <SiteFooter />
    </div>
  );
}
