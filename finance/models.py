from django.db import models  # type: ignore
from django.contrib.auth.models import User  # type: ignore
from django.db.models.signals import post_save  # type: ignore
from django.dispatch import receiver  # type: ignore

class Budget(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, null=True, blank=True)
    name = models.CharField(max_length=120)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    spent = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    def remaining(self):
        return max(self.amount - self.spent, 0)

    def __str__(self):
        return f"{self.name} ({self.amount})"


class Transaction(models.Model):
    TYPE_CHOICES = (
        ('expense', 'Expense'),
        ('income', 'Income'),
    )
    user = models.ForeignKey(User, on_delete=models.CASCADE, null=True, blank=True)
    title = models.CharField(max_length=200)
    transaction_type = models.CharField(max_length=10, choices=TYPE_CHOICES)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    category = models.CharField(max_length=100, blank=True)
    description = models.TextField(blank=True)
    date = models.DateField()
    budget = models.ForeignKey(Budget, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    def is_expense(self):
        return self.transaction_type == 'expense'

    def __str__(self):
        sign = '-' if self.is_expense() else '+'
        return f"{self.title} {sign}{self.amount}"


class Profile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    phone = models.CharField(max_length=20, blank=True)
    address = models.TextField(blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    avatar = models.ImageField(upload_to='avatars/', blank=True, null=True)
    premium = models.BooleanField(default=False)

    def __str__(self):
        return f"Profile for {self.user.username}"


@receiver(post_save, sender=User)
def create_user_profile(sender, instance, created, **kwargs):
    if created:
        Profile.objects.create(user=instance)


# NEW: Categories, Accounts, Goals
class Category(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, null=True, blank=True)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = 'Categories'

    def __str__(self):
        return self.name


class Account(models.Model):
    ACCOUNT_TYPES = (
        ('Checking', 'Checking'),
        ('Savings', 'Savings'),
        ('Cash', 'Cash'),
        ('Credit Card', 'Credit Card'),
    )
    user = models.ForeignKey(User, on_delete=models.CASCADE, null=True, blank=True)
    name = models.CharField(max_length=120)
    account_type = models.CharField(max_length=30, choices=ACCOUNT_TYPES, default='Checking')
    balance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({self.account_type})"


class Goal(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, null=True, blank=True)
    name = models.CharField(max_length=140)
    target_amount = models.DecimalField(max_digits=12, decimal_places=2)
    current_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    target_date = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def progress_percent(self):
        try:
            return int(min(100, (self.current_amount / self.target_amount) * 100))
        except Exception:
            return 0

    def __str__(self):
        return f"{self.name} ({self.current_amount}/{self.target_amount})"
