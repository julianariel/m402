import { chmod, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type PaymentStatus = 'prepared' | 'pending' | 'confirmed' | 'claimed' | 'failed';

export type StoredPayment = {
  id: string;
  txId?: string;
  serviceId: string;
  vaultAddress: string;
  url: string;
  price: string;
  receiptSecret: string;
  receipt: string;
  status: PaymentStatus;
  createdAt: string;
};

export type AgentState = {
  version: 1;
  payments: StoredPayment[];
  redeems: StoredRedeem[];
};

export type StoredRedeem = {
  id: string;
  txId?: string;
  vaultAddress: string;
  amount: string;
  status: 'prepared' | 'pending' | 'confirmed' | 'failed';
  createdAt: string;
};

const emptyState = (): AgentState => ({ version: 1, payments: [], redeems: [] });

function parseState(raw: string, file: string): AgentState {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${file}: state file is not valid JSON.`);
  }
  if (
    !value ||
    typeof value !== 'object' ||
    (value as { version?: unknown }).version !== 1 ||
    !Array.isArray((value as { payments?: unknown }).payments)
  ) {
    throw new Error(`${file}: unsupported or corrupt m402 state file.`);
  }
  const state = value as Omit<AgentState, 'redeems'> & { redeems?: StoredRedeem[] };
  return { ...state, redeems: Array.isArray(state.redeems) ? state.redeems : [] };
}

export async function loadState(file: string): Promise<AgentState> {
  try {
    return parseState(await readFile(file, 'utf8'), file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyState();
    throw error;
  }
}

export async function saveState(file: string, state: AgentState): Promise<void> {
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);

  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await rename(temporary, file);
    await chmod(file, 0o600);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function recordPayment(file: string, payment: StoredPayment): Promise<void> {
  const state = await loadState(file);
  const existing = state.payments.findIndex((candidate) => candidate.id === payment.id);
  if (existing >= 0) state.payments[existing] = payment;
  else state.payments.push(payment);
  await saveState(file, state);
}

export async function updatePaymentStatus(
  file: string,
  id: string,
  status: PaymentStatus,
): Promise<void> {
  const state = await loadState(file);
  const payment = state.payments.find((candidate) => candidate.id === id);
  if (!payment) throw new Error(`Payment ${id} is missing from ${file}.`);
  payment.status = status;
  await saveState(file, state);
}

export async function markPaymentSubmitted(file: string, id: string, txId: string): Promise<void> {
  const state = await loadState(file);
  const payment = state.payments.find((candidate) => candidate.id === id);
  if (!payment) throw new Error(`Payment ${id} is missing from ${file}.`);
  payment.txId = txId;
  payment.status = 'pending';
  await saveState(file, state);
}

export async function recordRedeem(file: string, redeem: StoredRedeem): Promise<void> {
  const state = await loadState(file);
  const existing = state.redeems.findIndex((candidate) => candidate.id === redeem.id);
  if (existing >= 0) state.redeems[existing] = redeem;
  else state.redeems.push(redeem);
  await saveState(file, state);
}

export async function markRedeemSubmitted(file: string, id: string, txId: string): Promise<void> {
  const state = await loadState(file);
  const redeem = state.redeems.find((candidate) => candidate.id === id);
  if (!redeem) throw new Error(`Redeem ${id} is missing from ${file}.`);
  redeem.txId = txId;
  redeem.status = 'pending';
  await saveState(file, state);
}

export async function updateRedeemStatus(
  file: string,
  id: string,
  status: StoredRedeem['status'],
): Promise<void> {
  const state = await loadState(file);
  const redeem = state.redeems.find((candidate) => candidate.id === id);
  if (!redeem) throw new Error(`Redeem ${id} is missing from ${file}.`);
  redeem.status = status;
  await saveState(file, state);
}

export async function findUnresolvedRedeem(
  file: string,
  vaultAddress: string,
): Promise<StoredRedeem | undefined> {
  const state = await loadState(file);
  return [...state.redeems]
    .reverse()
    .find(
      (redeem) =>
        redeem.vaultAddress === vaultAddress &&
        (redeem.status === 'prepared' || redeem.status === 'pending'),
    );
}

export async function findUnclaimedPayment(
  file: string,
  serviceId: string,
  vaultAddress: string,
): Promise<StoredPayment | undefined> {
  const state = await loadState(file);
  return [...state.payments]
    .reverse()
    .find(
      (payment) =>
        payment.serviceId === serviceId &&
        payment.vaultAddress === vaultAddress &&
        (payment.status === 'prepared' ||
          payment.status === 'pending' ||
          payment.status === 'confirmed'),
    );
}

async function processIsRunning(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

export async function withOperationLock<T>(file: string, action: () => Promise<T>): Promise<T> {
  const directory = path.dirname(file);
  const lockFile = `${file}.lock`;
  await mkdir(directory, { recursive: true, mode: 0o700 });

  let handle;
  try {
    try {
      handle = await open(lockFile, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const owner = Number((await readFile(lockFile, 'utf8')).trim());
      if (Number.isInteger(owner) && owner > 0 && !(await processIsRunning(owner))) {
        await rm(lockFile, { force: true });
        handle = await open(lockFile, 'wx', 0o600);
      } else {
        throw new Error(
          `Another m402 operation is active (lock: ${lockFile}). ` +
            'Payments and wallet transactions must run serially.',
        );
      }
    }

    await handle.writeFile(`${process.pid}\n`, 'utf8');
    return await action();
  } finally {
    await handle?.close();
    if (handle) await rm(lockFile, { force: true });
  }
}
