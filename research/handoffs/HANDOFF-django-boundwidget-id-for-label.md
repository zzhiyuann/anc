# HANDOFF: BoundWidget.id_for_label ignores id set by ChoiceWidget.options

**Task**: Django #32855 (django__django-14534)
**Repo**: django/django
**Status**: COMPLETED
**Complexity**: Low

## Bug Summary

`BoundWidget.id_for_label` hardcodes the label ID as `'id_%s_%s' % (name, index)` instead of using the actual `id` attribute from `self.data['attrs']['id']`. This means custom `auto_id` formats passed to forms are ignored when rendering labels for `CheckboxSelectMultiple` subwidgets.

## Root Cause

In `django/forms/boundfield.py`, the `BoundWidget` class has:

```python
@property
def id_for_label(self):
    return 'id_%s_%s' % (self.data['name'], self.data['index'])
```

This re-computes an ID using a hardcoded `id_` prefix, ignoring the ID that was already correctly computed and stored in `self.data['attrs']['id']` by `BoundField.subwidgets`.

The flow is:
1. `BoundField.subwidgets` computes `id_` from `self.field.widget.attrs.get('id') or self.auto_id`
2. It passes `{'id': id_}` into `self.field.widget.subwidgets(...)` which builds per-choice dicts
3. Each choice dict has `attrs['id']` set correctly (e.g. `custom_color_0`, `custom_color_1`)
4. **BUG**: `BoundWidget.id_for_label` ignores `attrs['id']` and reconstructs `id_%s_%s`

## Fix

**File**: `django/forms/boundfield.py`, `BoundWidget.id_for_label` property

```diff
 @property
 def id_for_label(self):
-    return 'id_%s_%s' % (self.data['name'], self.data['index'])
+    return self.data['attrs'].get('id')
```

Using `.get('id')` returns `None` when no id is present (e.g. `auto_id=False`), which is correct behavior — matches how other `id_for_label` implementations work across Django's widget classes.

## Test

**File**: `tests/forms_tests/tests/test_forms.py`

```python
def test_boundfield_subwidget_id_for_label(self):
    """
    If auto_id is provided when initializing the form, the generated ID in
    subwidgets must reflect that prefix.
    """
    class SomeForm(Form):
        field = MultipleChoiceField(
            choices=[('a', 'A'), ('b', 'B')],
            widget=CheckboxSelectMultiple,
        )

    form = SomeForm(auto_id='prefix_%s')
    subwidgets = form['field'].subwidgets
    self.assertEqual(subwidgets[0].id_for_label, 'prefix_field_0')
    self.assertEqual(subwidgets[1].id_for_label, 'prefix_field_1')
```

Also updates existing test for `auto_id=False` case:

```diff
- self.assertEqual(fields[0].id_for_label, 'id_name_0')
+ self.assertEqual(fields[0].id_for_label, None)
```

When `auto_id=False`, no ID should be generated — returning `None` instead of a hardcoded `id_name_0` is the correct behavior.

## Verification

All three cases work correctly after the fix:

| Scenario | Before (broken) | After (fixed) |
|---|---|---|
| Default `auto_id='id_%s'` | `id_color_0` (happened to be correct) | `id_color_0` |
| Custom `auto_id='prefix_%s'` | `id_color_0` (WRONG) | `prefix_color_0` |
| `auto_id=False` | `id_color_0` (WRONG) | `None` |

## Reference

Django commit: `db1fc5cd3c5d36cdb5d0fe4404efd6623dd3e8fb`
