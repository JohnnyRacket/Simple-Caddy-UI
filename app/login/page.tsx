import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 p-8 rounded-lg border border-border bg-card">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Caddy UI</h1>
          <p className="text-sm text-muted-foreground">Enter your access token to continue.</p>
        </div>
        <form action="/api/auth/login" method="POST" className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="token">Token</Label>
            <Input
              id="token"
              name="token"
              type="password"
              required
              autoFocus
              placeholder="••••••••"
            />
          </div>
          {error && (
            <p className="text-sm text-destructive">Invalid token. Please try again.</p>
          )}
          <Button type="submit" className="w-full">
            Sign in
          </Button>
        </form>
      </div>
    </div>
  )
}
