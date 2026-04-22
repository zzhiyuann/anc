# HANDOFF: Django makemigrations router.allow_migrate() Fix

## Bug Summary

**Ticket**: Django #27461 (originally reported in #27200 comment:14)
**PR**: https://github.com/django/django/pull/7530
**Fix commit**: `373c6c409c` (master), `7fd379719a` (1.10.x backport)
**Affected versions**: Django 1.10.0–1.10.3 (introduced by the consistency check feature in #27200)

The `makemigrations` command's consistency check calls `router.allow_migrate()` with incorrect `(app_label, model)` pairs. For each app, it passes **all models in the project** instead of only the models belonging to that app. This breaks custom database routers that validate the app_label/model combination (e.g., sharding routers where not all shards have the same models).

## Root Cause

In `django/core/management/commands/makemigrations.py` (line ~107), the consistency check loop used `apps.get_models(app_label)`. The critical mistake: `apps.get_models()` (which is `Apps.get_models()`) **ignores positional arguments** — its signature is `get_models(include_auto_created=False, include_swapped=False)`. The `app_label` string was silently consumed as `include_auto_created` (truthy), and the method returned **every model in the entire project**.

```python
# BUGGY CODE (before fix)
for alias in sorted(aliases_to_check):
    connection = connections[alias]
    if (connection.settings_dict['ENGINE'] != 'django.db.backends.dummy' and any(
            router.allow_migrate(connection.alias, app_label, model_name=model._meta.object_name)
            for app_label in consistency_check_labels
            for model in apps.get_models(app_label)  # BUG: app_label is silently ignored
    )):
        loader.check_consistent_history(connection)
```

Result: `allow_migrate()` received invalid combinations like `('default', 'auth', model_name='SomeUnrelatedModel')` where the model doesn't belong to the `auth` app.

## Fix

**One-line change** — line 108 of `makemigrations.py`:

```python
# BEFORE (buggy):
for model in apps.get_models(app_label)

# AFTER (fixed):
for model in apps.get_app_config(app_label).get_models()
```

`apps.get_app_config(app_label)` returns the `AppConfig` for that specific app, and its `.get_models()` only yields models registered to that app. This ensures `allow_migrate()` always receives valid `(app_label, model_name)` pairs.

### Fixed code in full context:

```python
# Raise an error if any migrations are applied before their dependencies.
consistency_check_labels = set(config.label for config in apps.get_app_configs())
# Non-default databases are only checked if database routers used.
aliases_to_check = connections if settings.DATABASE_ROUTERS else [DEFAULT_DB_ALIAS]
for alias in sorted(aliases_to_check):
    connection = connections[alias]
    if (connection.settings_dict['ENGINE'] != 'django.db.backends.dummy' and any(
            # At least one model must be migrated to the database.
            router.allow_migrate(connection.alias, app_label, model_name=model._meta.object_name)
            for app_label in consistency_check_labels
            for model in apps.get_app_config(app_label).get_models()  # FIXED
    )):
        loader.check_consistent_history(connection)
```

## Test Changes

In `tests/migrations/test_commands.py`, two changes to `test_makemigrations_consistency_checks_respect_routers`:

### 1. Add `@override_settings` decorator

```python
# Added to ensure multiple apps are installed (so the cross-app bug manifests)
@override_settings(INSTALLED_APPS=['migrations', 'migrations2'])
def test_makemigrations_consistency_checks_respect_routers(self):
```

### 2. Validate ALL `allow_migrate()` calls use correct pairs

```python
# BEFORE: only checked one specific call
allow_migrate.assert_called_with('other', 'migrations', model_name='UnicodeModel')

# AFTER: validates ALL calls have valid app_label/model_name pairs
allow_migrate.assert_any_call('other', 'migrations', model_name='UnicodeModel')
# allow_migrate() is called with the correct arguments.
self.assertGreater(len(allow_migrate.mock_calls), 0)
for mock_call in allow_migrate.mock_calls:
    _, call_args, call_kwargs = mock_call
    connection_alias, app_name = call_args
    self.assertIn(connection_alias, ['default', 'other'])
    # Raises an error if invalid app_name/model_name occurs.
    apps.get_app_config(app_name).get_model(call_kwargs['model_name'])
```

The key assertion: `apps.get_app_config(app_name).get_model(call_kwargs['model_name'])` raises `LookupError` if the model doesn't belong to that app — catching exactly the bug that was reported.

### Release note (`docs/releases/1.10.4.txt`)

```
* Fixed incorrect ``app_label`` / ``model_name`` arguments for
  ``allow_migrate()`` in ``makemigrations`` migration consistency checks
  (:ticket:`27461`).
```

## Why This Matters

Custom database routers implementing `allow_migrate()` use the `(app_label, model_name)` pair to decide routing. Invalid pairs cause:

1. **Errors** — sharding routers that validate pairs raise exceptions (the reporter's case)
2. **Silent incorrect results** — routers may return wrong values for impossible pairs, potentially skipping needed consistency checks
3. **Confusing debugging** — the mismatch between app_label and model makes logs misleading

## Files Changed

| File | Change |
|------|--------|
| `django/core/management/commands/makemigrations.py:108` | `apps.get_models(app_label)` → `apps.get_app_config(app_label).get_models()` |
| `tests/migrations/test_commands.py:601,641-650` | `@override_settings` decorator + validate all allow_migrate() call args |
| `docs/releases/1.10.4.txt` | Release note documenting the fix |

## Status: COMPLETED
