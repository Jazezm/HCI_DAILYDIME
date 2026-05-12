from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from django.db.models import Sum
from .models import Transaction, Budget

@receiver(post_save, sender=Transaction)
def update_budget_on_save(sender, instance, created, **kwargs):
    if instance.budget:
        budget = instance.budget
        total = Transaction.objects.filter(budget=budget, transaction_type='expense').aggregate(total=Sum('amount'))['total'] or 0
        budget.spent = total
        budget.save()

@receiver(post_delete, sender=Transaction)
def update_budget_on_delete(sender, instance, **kwargs):
    if instance.budget:
        budget = instance.budget
        total = Transaction.objects.filter(budget=budget, transaction_type='expense').aggregate(total=Sum('amount'))['total'] or 0
        budget.spent = total
        budget.save()
