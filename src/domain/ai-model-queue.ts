export type AiModelQueuePreference = {
  providerId: string;
  modelId: string;
};

export type AiModelQueueSelection = AiModelQueuePreference & {
  enabled: boolean;
  sortOrder: number;
};

/** Initialize the unified queue while retaining selections made by older releases. */
export function initializeAiModelQueue(
  availableModels: AiModelQueuePreference[],
  existingSelections: AiModelQueueSelection[],
): AiModelQueueSelection[] {
  const uniqueAvailable = availableModels.filter((item, index, items) =>
    items.findIndex((entry) => modelKey(entry) === modelKey(item)) === index);
  const availableKeys = new Set(uniqueAvailable.map(modelKey));
  const existingByKey = new Map(existingSelections.map((item) => [modelKey(item), item]));
  const priorOrder = existingSelections
    .filter((item) => item.enabled && availableKeys.has(modelKey(item)))
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder
      || left.providerId.localeCompare(right.providerId)
      || left.modelId.localeCompare(right.modelId));
  const newModels = uniqueAvailable.filter((item) => !existingByKey.has(modelKey(item)));
  const enabledOrder = [...priorOrder, ...newModels];
  const disabledModels = uniqueAvailable.filter((item) => existingByKey.get(modelKey(item))?.enabled === false);

  return [
    ...enabledOrder.map((item, sortOrder) => ({ ...item, enabled: true, sortOrder })),
    ...disabledModels.map((item, index) => ({ ...item, enabled: false, sortOrder: enabledOrder.length + index })),
  ];
}

export type AiModelQueueAccount = {
  id: string;
  providerId: string;
  sortOrder: number;
  models: { id: string }[];
};

export type AiModelQueueCandidate<Account extends AiModelQueueAccount = AiModelQueueAccount> = {
  account: Account;
  providerId: string;
  modelId: string;
  queueOrder: number;
  accountOrder: number;
};

/** Expand a single user-defined model queue into account-specific fallback candidates. */
export function expandAiModelQueue<Account extends AiModelQueueAccount>(
  queue: AiModelQueuePreference[],
  accounts: Account[],
): AiModelQueueCandidate<Account>[] {
  return queue.flatMap((item, queueOrder) => {
    const matches = accounts
      .map((account, originalOrder) => ({ account, originalOrder }))
      .filter(({ account }) => account.providerId === item.providerId && account.models.some((model) => model.id === item.modelId))
      .sort((left, right) => left.account.sortOrder - right.account.sortOrder || left.originalOrder - right.originalOrder);

    return matches.map(({ account }, accountOrder) => ({
      account,
      providerId: item.providerId,
      modelId: item.modelId,
      queueOrder,
      accountOrder,
    }));
  });
}

function modelKey(item: AiModelQueuePreference): string {
  return `${item.providerId}:${item.modelId}`;
}
