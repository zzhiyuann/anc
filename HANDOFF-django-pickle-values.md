# HANDOFF: Django QuerySet pickle + values()/values_list() Fix

## Bug Summary

**Issue:** QuerySet with `values()`/`values_list()` crashes when recreated from a pickled query. Assigning a pickled `query` object to a new QuerySet via `qs.query = pickle.loads(...)` loses the values/values_list mode — the QuerySet returns model instances instead of dicts/tuples, causing `AttributeError: 'NoneType' object has no attribute 'attname'`.

## Root Cause

The `QuerySet.query` setter (in `django/db/models/query.py`) only checked whether `values_select` was truthy and always set `_iterable_class = ValuesIterable`. It had no way to distinguish between the four possible modes:

- `ValuesIterable` (from `values()`)
- `ValuesListIterable` (from `values_list()`)
- `FlatValuesListIterable` (from `values_list(flat=True)`)
- `NamedValuesListIterable` (from `values_list(named=True)`)

## Fix (3 files changed)

### 1. `django/db/models/sql/query.py` — Add tracking attribute

Added `values_select_mode = None` class attribute to `Query`. Stores one of: `"values"`, `"list"`, `"flat"`, `"named"`, or `None`.

### 2. `django/db/models/query.py` — Set the mode + use it in setter

- `values()` sets `clone.query.values_select_mode = "values"`
- `values_list()` sets `"named"`, `"flat"`, or `"list"` based on kwargs
- `query.setter` maps the mode string back to the correct iterable class, falling back to `ValuesIterable` for backward compat with old pickled queries that lack the attribute

### 3. `tests/queryset_pickle/tests.py` — Fix existing tests

Replaced the `test_annotation_values_list` test (which accepted the broken behavior with a comment "values_list() is reloaded to values()") with three separate tests that verify each mode round-trips correctly through pickle:

- `test_annotation_values_list` — expects tuple `("test",)`
- `test_annotation_values_list_flat` — expects scalar `"test"`
- `test_annotation_values_list_named` — expects namedtuple with `.name == "test"`

## Verification

All 45 queryset_pickle tests pass:
```
Ran 45 tests in 0.730s — OK
```

## Files Modified

| File | Change |
|------|--------|
| `/tmp/django/django/db/models/sql/query.py` | Added `values_select_mode = None` attribute |
| `/tmp/django/django/db/models/query.py` | Set mode in `values()`/`values_list()`, use it in `query.setter` |
| `/tmp/django/tests/queryset_pickle/tests.py` | Updated tests to verify correct round-trip behavior |
