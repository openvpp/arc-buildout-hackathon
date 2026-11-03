import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';

/** What a signed-out visitor sees on a signed-in page. */
export function SignInPrompt({
  title,
  description,
}: {
  readonly title: string;
  readonly description: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} description={description} />
      <EmptyState
        title="Sign in to continue"
        description="Sign in with the button above to open your Circle wallet and your devices."
      />
    </div>
  );
}
