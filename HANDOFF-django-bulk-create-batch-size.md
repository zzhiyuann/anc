# HANDOFF: Django bulk_create batch_size bug fix (Ticket #30827)

## Bug

In Django's `QuerySet._batched_insert()`, the `batch_size` parameter passed by the user **overrides** the database-compatible maximum batch size calculated by `DatabaseOperations.bulk_batch_size()`. This means a user can pass a `batch_size` larger than what the database supports, causing query failures (e.g., exceeding SQLite's `SQLITE_MAX_VARIABLE_NUMBER` limit).

**Buggy code** (in `_batched_insert`, circa Django 2.2):

```python
batch_size = (batch_size or max(ops.bulk_batch_size(fields, objs), 1))
```

This uses `batch_size` as-is when truthy (non-zero), only falling back to `bulk_batch_size()` when `batch_size` is `None`/`0`. It never clamps the user-provided value.

**Contrast with `bulk_update`** which already does it correctly:

```python
max_batch_size = connection.ops.bulk_batch_size([opts.pk, opts.pk, *fields], objs)
batch_size = min(batch_size, max_batch_size) if batch_size else max_batch_size
```

## Fix

**File**: `django/db/models/query.py`, in `_batched_insert()`

**Change** (one line → two lines):

```python
# Before (buggy):
batch_size = (batch_size or max(ops.bulk_batch_size(fields, objs), 1))

# After (fixed):
max_batch_size = max(ops.bulk_batch_size(fields, objs), 1)
batch_size = min(batch_size, max_batch_size) if batch_size else max_batch_size
```

This ensures:
- If `batch_size` is provided, use `min(batch_size, max_batch_size)` — never exceed the DB limit
- If `batch_size` is `None`/`0`, fall back to `max_batch_size`

## Test

```python
from math import ceil

@skipUnlessDBFeature('has_bulk_insert')
def test_explicit_batch_size_respects_max_batch_size(self):
    objs = [Country() for i in range(1000)]
    fields = ['name', 'iso_two_letter', 'description']
    max_batch_size = max(connection.ops.bulk_batch_size(fields, objs), 1)
    with self.assertNumQueries(ceil(len(objs) / max_batch_size)):
        Country.objects.bulk_create(objs, batch_size=max_batch_size + 1)
```

The test creates 1000 objects and calls `bulk_create` with `batch_size = max_batch_size + 1`. It asserts that the number of SQL queries matches `ceil(1000 / max_batch_size)` — proving the DB limit is respected even when the user passes a larger batch_size.

## Changes Applied

### 1. Fix: `django/db/models/query.py` line 1048

**Before** (buggy):
```python
batch_size = (batch_size or max(ops.bulk_batch_size(fields, objs), 1))
```

**After** (fixed):
```python
max_batch_size = max(ops.bulk_batch_size(fields, objs), 1)
batch_size = min(batch_size, max_batch_size) if batch_size else max_batch_size
```

**Workspace file**: `/Users/zwang/anc-workspaces/task-b4b16579-a6f1-4c11-8090-7dbe9cbc4326/django/django/db/models/query.py:1048-1049`

### 2. Test: `tests/bulk_create/tests.py`

Added `test_explicit_batch_size_respects_max_batch_size` after line 199. This test:
- Creates 1000 `Country` objects
- Calls `bulk_create` with `batch_size = max_batch_size + 1`
- Asserts query count equals `ceil(1000 / max_batch_size)` — proving the DB limit is enforced

**Workspace file**: `/Users/zwang/anc-workspaces/task-b4b16579-a6f1-4c11-8090-7dbe9cbc4326/django/tests/bulk_create/tests.py:201-208`

Also added `from math import ceil` import at line 3.

### 3. Test limitation

Tests could not be run locally because the workspace Django version (2.2.x) is incompatible with the available Python 3.9 (`__classcell__` error). The fix is verified by code inspection — it matches the exact pattern used in `bulk_update()` and matches the upstream fix (commit `09578f6dfb`).

## Upstream Status

This was fixed upstream in commit `09578f6dfb` (Django ticket #30827, merged into Django 3.0). The fix is a 2-line change in `_batched_insert()`. In modern Django (main branch), the fix has been further refactored — `_batched_insert` now lives at line ~2127 and already includes the `min()` logic.
