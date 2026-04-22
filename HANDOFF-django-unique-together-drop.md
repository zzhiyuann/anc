# HANDOFF: Django — Cannot drop unique_together on field with existing unique constraint

## Problem

When a model has a `unique_together` constraint on a single field that also has its own unique constraint (either `unique=True` or is a primary key), Django's migration system fails with:

```
ValueError: Found wrong number (2) of constraints for table(column)
```

This happens because `_delete_composed_index()` in `BaseDatabaseSchemaEditor` calls `_constraint_names()` with `unique=True`, which returns **all** unique constraints on those columns — including the PK constraint or the field-level `unique=True` constraint. The code then asserts exactly 1 result and crashes.

**Example scenario** (from ticket):
```
Indexes:
    "foo_bar_pkey" PRIMARY KEY, btree (id)
    "foo_bar_id_1c3b3088c74c3b17_uniq" UNIQUE CONSTRAINT, btree (id)
```

The migration to remove `unique_together = (('id',),)` finds both constraints and raises `ValueError`.

## Root Cause

`django/db/backends/base/schema.py` line 362-371 — `_delete_composed_index()` blindly expects exactly one constraint matching `{unique: True}` on the given columns, with no disambiguation logic.

## Fix

**File:** `django/db/backends/base/schema.py` — `_delete_composed_index()` method

Two-stage narrowing when multiple constraints are found:

1. **Exclude primary key constraints** — re-query with `primary_key=False` added to the filter. This handles the PK + unique_together overlap case.

2. **Match by Django's generated name** — if still ambiguous (e.g., field has both `unique=True` and `unique_together`), compute the expected constraint name using `_create_index_name()` with the appropriate suffix (`_uniq` for unique, `_idx` for index) and match against it.

The fix only activates when `len(constraint_names) > 1`, so the normal single-constraint path is unchanged.

```python
def _delete_composed_index(self, model, fields, constraint_kwargs, sql):
    columns = [model._meta.get_field(field).column for field in fields]
    constraint_names = self._constraint_names(model, columns, **constraint_kwargs)
    if len(constraint_names) > 1:
        # Exclude primary key constraints
        constraint_names = self._constraint_names(
            model, columns, primary_key=False, **constraint_kwargs
        )
    if len(constraint_names) > 1:
        # Match Django's generated name for unique_together/index_together
        suffix = constraint_kwargs.get('unique') and '_uniq' or '_idx'
        expected_name = self._create_index_name(model, columns, suffix=suffix)
        matching = [name for name in constraint_names if name == expected_name]
        if len(matching) == 1:
            constraint_names = matching
    if len(constraint_names) != 1:
        raise ValueError(...)
    self.execute(self._delete_constraint_sql(sql, model, constraint_names[0]))
```

## Tests Added

**File:** `tests/schema/tests.py` — two new test methods:

1. **`test_unique_together_with_unique_field`** — Creates a Tag model (slug has `unique=True`), adds `unique_together` on slug, verifies 2 unique constraints exist, then drops `unique_together` without error, verifying only 1 constraint remains.

2. **`test_unique_together_with_pk`** — Adds `unique_together` on the PK field (`id`), verifies multiple unique constraints exist, then drops `unique_together` without error.

## Files Changed

| File | Change |
|------|--------|
| `django/db/backends/base/schema.py` | Modified `_delete_composed_index()` to disambiguate constraints |
| `tests/schema/tests.py` | Added 2 regression tests for #23740 |

## Notes

- MySQL's `_delete_composed_index()` override calls `super()`, so the fix is inherited correctly.
- The fix is backwards-compatible: when only 1 constraint matches (the normal case), the new code paths are never entered.
- Tests could not be executed locally due to Python 3.9 / old Django version incompatibility (`__classcell__` issue), but the logic was verified independently.
- This corresponds to Django ticket #23740.
