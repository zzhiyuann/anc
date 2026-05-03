# HANDOFF: Django makemigrations router.allow_migrate() Bug Fix

## Bug Summary

**Ticket:** Django #27461 (originally reported in #27200 comment #14)
**Severity:** Release blocker (Django 1.10)
**Fixed in:** Django 1.10.4 (commit `373c6c4`, backport `7fd3797`)

## Root Cause

In `django/core/management/commands/makemigrations.py`, the consistency check calls `router.allow_migrate()` with incorrect `(app_label, model)` pairs.

### Buggy Code (Django 1.10.0-1.10.3)

```python
for alias in sorted(aliases_to_check):
    connection = connections[alias]
    if (connection.settings_dict['ENGINE'] != 'django.db.backends.dummy' and any(
            router.allow_migrate(connection.alias, app_label, model_name=model._meta.object_name)
            for app_label in consistency_check_labels
            for model in apps.get_models(app_label)    # <-- BUG
    )):
        loader.check_consistent_history(connection)
```

**The problem:** `apps.get_models(app_label)` does NOT filter by app_label — it returns **all models in the entire project**. This means every `app_label` is paired with every model from every app, creating invalid combinations like:
- `allow_migrate('default', 'auth', model_name='MyAppModel')` — WRONG
- `allow_migrate('default', 'myapp', model_name='User')` — WRONG

This breaks routers for sharded databases where not all shards have the same models.

### Fixed Code

```python
for alias in sorted(aliases_to_check):
    connection = connections[alias]
    if (connection.settings_dict['ENGINE'] != 'django.db.backends.dummy' and any(
            router.allow_migrate(connection.alias, app_label, model_name=model._meta.object_name)
            for app_label in consistency_check_labels
            for model in apps.get_app_config(app_label).get_models()    # <-- FIX
    )):
        loader.check_consistent_history(connection)
```

**The fix:** Replace `apps.get_models(app_label)` with `apps.get_app_config(app_label).get_models()` — this returns only the models belonging to the specified app.

## Code Change

**File:** `django/core/management/commands/makemigrations.py`

```diff
-    for model in apps.get_models(app_label)
+    for model in apps.get_app_config(app_label).get_models()
```

One line change.

## Test Changes

**File:** `tests/migrations/test_commands.py`

### 1. Add proper INSTALLED_APPS isolation

```diff
+@override_settings(INSTALLED_APPS=['migrations', 'migrations2'])
 def test_makemigrations_consistency_checks_respect_routers(self):
```

Adding `@override_settings` with multiple apps ensures cross-app model leakage is detectable.

### 2. Validate all allow_migrate() calls use correct pairs

Replace the weak single assertion:

```diff
-allow_migrate.assert_called_with('other', 'migrations', model_name='UnicodeModel')
+allow_migrate.assert_any_call('other', 'migrations', model_name='UnicodeModel')
+# allow_migrate() is called with the correct arguments.
+self.assertGreater(len(allow_migrate.mock_calls), 0)
+for mock_call in allow_migrate.mock_calls:
+    _, call_args, call_kwargs = mock_call
+    connection_alias, app_name = call_args
+    self.assertIn(connection_alias, ['default', 'other'])
+    # Raises LookupError if invalid app_name/model_name pair.
+    apps.get_app_config(app_name).get_model(call_kwargs['model_name'])
```

This iterates every `allow_migrate()` call and verifies:
- Connection alias is a valid database (`'default'` or `'other'`)
- The `(app_name, model_name)` pair is valid — `get_model()` raises `LookupError` if the model doesn't belong to that app

## Why This Matters

Custom database routers for sharding rely on correct `(app_label, model_name)` pairs. Invalid pairs cause routers to:
1. Raise errors (strict validation)
2. Route models to wrong shards
3. Silently skip migrations that should be applied

## Timeline

- **Django 1.10.0:** `allow_migrate()` called without `model_name` (#27200)
- **Django ~1.10.2:** Fix added `model_name` but used `apps.get_models(app_label)` returning ALL models
- **Django 1.10.4:** Corrected to `apps.get_app_config(app_label).get_models()` (#27461, PR #7530)
