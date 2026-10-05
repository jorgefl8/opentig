import { isDevProfile } from '@/lib/app-identity';
import { Badge } from '@/components/ui/badge';

export function DevIndicator() {
  if (!isDevProfile) return null;
  return <Badge variant="outline" aria-label="Development instance"><span className="dev-instance-stripe" aria-hidden="true" />DEV</Badge>;
}
